import { parseHTML } from "./html/parse";
import { normalizeAttributes } from "./attrs";
import { splitTextExpressionParts } from "./text";
import { parseEventAttribute } from "./events";
import { CompilerError, NullOrUndefinedError } from "./errors";
import type { TemplateNode, CompileOptions } from "./types";
import type { ComponentIR, Binding } from "./ir";
import { generateComponent } from "./codegen";
import { parseSFC, transpileScript } from "./sfc/parseSFC";
import {
  hasIfDirective,
  hasSwitchDirective,
  collectIfChain,
  type SwitchCase,
} from "./clusters";

/** Control-flow-only attributes (compile-time only, never emit bindings). */
const CONTROL_FLOW_ATTRS = new Set<string>([
  "m-if",
  "m-else-if",
  "m-else",
  "m-switch",
  "m-case",
  "m-default",
]);

/** Helpful guards for dangling branches at root/child positions. */
function isElseLike(attrs: Record<string, unknown> | undefined): boolean {
  if (!attrs) return false;
  return (
    Object.prototype.hasOwnProperty.call(attrs, "m-else") ||
    Object.prototype.hasOwnProperty.call(attrs, "m-else-if")
  );
}
function isCaseLike(attrs: Record<string, unknown> | undefined): boolean {
  if (!attrs) return false;
  return (
    Object.prototype.hasOwnProperty.call(attrs, "m-case") ||
    Object.prototype.hasOwnProperty.call(attrs, "m-default")
  );
}

/** Helper: treat whitespace-only text as ignorable between branches/cases. */
function isWhitespaceText(node: TemplateNode | undefined): boolean {
  return (
    !!node && node.type === "text" && (!node.value || node.value.trim() === "")
  );
}

/** NEW: collect switch cases when they are CHILDREN of the host element. */
function collectSwitchFromChildren(children: TemplateNode[]): SwitchCase[] {
  const cases: SwitchCase[] = [];
  let seenDefault = false;

  for (let idx = 0; idx < children.length; idx++) {
    const child = children[idx];
    if (isWhitespaceText(child)) continue;
    if (!child || child.type !== "el") continue;

    const attrs = (child.attrs ?? {}) as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(attrs, "m-case")) {
      if (seenDefault)
        throw new CompilerError("m-case cannot appear after m-default.");
      const raw = attrs["m-case"];
      if (typeof raw !== "string" || raw.trim().length === 0) {
        throw new CompilerError("m-case requires a non-empty expression.");
      }
      cases.push({ matchExpr: raw.trim(), node: child });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(attrs, "m-default")) {
      if (seenDefault)
        throw new CompilerError(
          "Only one m-default is allowed in a switch cluster."
        );
      cases.push({ matchExpr: null, node: child });
      seenDefault = true;
      continue;
    }
    // non case/default child — ignore (acts like plain content outside the switch)
  }

  if (cases.length === 0) {
    throw new CompilerError(
      "m-switch must have at least one m-case or m-default child."
    );
  }
  return cases;
}

/**
 * Compile template HTML → ComponentIR (MVP + control-flow).
 */
export function compileTemplateToIR(
  html: string,
  { file, name, scopeAttr, strict = true }: CompileOptions
): ComponentIR {
  if (!file) throw new CompilerError("Option 'file' must be provided.");
  if (!name) throw new CompilerError("Option 'name' must be provided.");

  const rootAst = parseHTML(html);

  const createStatements: string[] = [];
  const mountStatements: string[] = [];
  const bindingList: Binding[] = [];
  const importNames = new Set<string>(["Dom"]);

  // readable ids
  let autoId = 0;
  const makeId = (prefix: string) => `_${prefix}${++autoId}`;

  const insertIntoDom = (
    childVar: string,
    parentVar: string,
    useAnchor = false
  ) => {
    mountStatements.push(
      useAnchor
        ? `Dom.insert(${childVar}, ${parentVar}, anchor ?? null);`
        : `Dom.insert(${childVar}, ${parentVar});`
    );
  };

  const useReactive = () => {
    importNames.add("effect");
    importNames.add("stop");
  };

  /** Block factory used by control-flow branches/cases. */
  function makeBlockFactory(childNodes: TemplateNode[]): string {
    const localCreate: string[] = [];
    const localMount: string[] = [];
    const localBindings: Binding[] = [];
    const localImports = new Set<string>();
    const localId = (p: string) => `__b_${p}${++autoId}`;

    const localInsert = (childVar: string, parentVar: string) => {
      localMount.push(`Dom.insert(${childVar}, ${parentVar}, __end);`);
    };

    const walkInline = (node: TemplateNode, parentVar: string): void => {
      if (!node) throw new CompilerError("inline walk: node must not be null.");

      if (node.type === "text") {
        const parts = splitTextExpressionParts(node.value);
        for (const part of parts) {
          const t = localId("text");
          if (part.kind === "static") {
            localCreate.push(
              `const ${t} = Dom.createText(${JSON.stringify(part.value)});`
            );
            localInsert(t, parentVar);
          } else {
            localCreate.push(`const ${t} = Dom.createText('');`);
            localInsert(t, parentVar);
            localBindings.push({ kind: "text", target: t, expr: part.value });
            localImports.add("bindText");
          }
        }
        return;
      }

      if (!node.tag)
        throw new CompilerError("Element node is missing tag name.");
      const el = localId("el");
      localCreate.push(
        `const ${el} = Dom.createElement(${JSON.stringify(node.tag)});`
      );
      if (scopeAttr)
        localCreate.push(
          `Dom.setAttr(${el}, ${JSON.stringify(scopeAttr)}, "");`
        );

      const attrs = normalizeAttributes(node.attrs || {});
      for (const name of Object.keys(attrs)) {
        if (CONTROL_FLOW_ATTRS.has(name)) continue;
        const value = (attrs as any)[name];
        if (strict && value == null)
          throw new NullOrUndefinedError(
            "Attribute ${name} has nullish value."
          );
        if (value === undefined)
          throw new NullOrUndefinedError(
            "Attribute ${name} has undefined value."
          );

        if (name === "m-text") {
          const t = localId("text");
          localCreate.push(`const ${t} = Dom.createText('');`);
          localInsert(t, el);
          localBindings.push({ kind: "text", target: t, expr: value });
          localImports.add("bindText");
          continue;
        }
        if (name === "m-class") {
          localBindings.push({ kind: "class", target: el, expr: value });
          localImports.add("bindClass");
          continue;
        }
        if (name === "m-style") {
          localBindings.push({ kind: "style", target: el, expr: value });
          localImports.add("bindStyle");
          continue;
        }
        if (name === "m-show") {
          localBindings.push({ kind: "show", target: el, expr: value });
          localImports.add("bindShow");
          continue;
        }

        if (name.startsWith("@")) {
          const { type } = parseEventAttribute(name);
          localBindings.push({
            kind: "event",
            target: el,
            type,
            handler: value,
          });
          localImports.add("onEvent");
          continue;
        }
        if (name.startsWith("m-")) {
          const plain = name.slice(2);
          if (!plain)
            throw new CompilerError(
              "m- attribute must have a name, e.g., m-id"
            );
          localBindings.push({
            kind: "attr",
            target: el,
            name: plain,
            expr: value,
          });
          localImports.add("bindAttr");
          continue;
        }

        localCreate.push(
          `Dom.setAttr(${el}, ${JSON.stringify(name)}, ${JSON.stringify(
            value
          )});`
        );
      }

      for (const c of node.children) walkInline(c, el);
      localInsert(el, parentVar);
    };

    const ROOT = "__root"; // parameter
    const OUTER_ANCHOR = "__anchor"; // parameter

    for (const cn of childNodes) walkInline(cn, ROOT);
    for (const imp of Array.from(localImports)) importNames.add(imp);

    const localBindingCode = localBindings
      .map((b) => {
        switch (b.kind) {
          case "text":
            return `__stops.push(bindText(${b.target}, ()=>(${
              (b as any).expr
            })));`;
          case "class":
            return `__stops.push(bindClass(${b.target}, ()=>(${
              (b as any).expr
            })));`;
          case "style":
            return `__stops.push(bindStyle(${b.target}, ()=>(${
              (b as any).expr
            })));`;
          case "show":
            return `__stops.push(bindShow(${b.target}, ()=>!!(${
              (b as any).expr
            })));`;
          case "attr":
            return `__stops.push(bindAttr(${b.target}, ${JSON.stringify(
              (b as any).name
            )}, ()=>(${(b as any).expr})));`;
          case "event":
            return `__stops.push(onEvent((ctx as any).app, ${
              b.target
            }, ${JSON.stringify((b as any).type)}, (e)=>(${
              (b as any).handler
            })));`;
          default:
            return "";
        }
      })
      .join("\n");

    return `((parent, ${OUTER_ANCHOR})=>{
    const __stops: Array<()=>void> = [];
    const ${ROOT} = parent;
    const __start = Dom.createAnchor('blk-start');
    const __end   = Dom.createAnchor('blk-end');
    Dom.insert(__start, ${ROOT}, ${OUTER_ANCHOR});
    Dom.insert(__end,   ${ROOT}, ${OUTER_ANCHOR});
${localCreate.join("\n")}
${localMount.join("\n")}
${localBindingCode}
    return ()=> {
      // Remove everything between __start and __end
      let n = __start.nextSibling;
      while (n && n !== __end) {
        const next = n.nextSibling;
        Dom.remove(n);
        n = next;
      }
      for (let i = __stops.length - 1; i >= 0; i--) { try { __stops[i](); } catch {} }
      Dom.remove(__start);
      Dom.remove(__end);
    };
  })`;
  }

  function buildSwitchIfElse(
    cases: SwitchCase[],
    switchExpr: string,
    factories: string[],
    parentVar: string,
    anchorVar: string
  ): string {
    if (!cases.length)
      throw new CompilerError("buildSwitchIfElse: cases must not be empty.");
    let out = "";
    for (let i = 0; i < cases.length; i++) {
      const def = cases[i];
      if (!def) continue;

      const predicate =
        def.matchExpr == null
          ? "true"
          : `((${switchExpr}) === (${def.matchExpr}))`;
      out += `${i === 0 ? "if" : "else if"} (${predicate}) __next = ${
        factories[i]
      }(${parentVar}, ${anchorVar});\n    `;
    }
    out += "else __next = null;";
    return out;
  }

  /** Main walker */
  const walkTemplate = (
    node: TemplateNode,
    parentVar?: string,
    siblings?: TemplateNode[],
    index?: number
  ): string => {
    if (!node) throw new CompilerError("walk: node must not be null.");

    // TEXT
    if (node.type === "text") {
      const parts = splitTextExpressionParts(node.value);
      let lastTextVar = "";
      for (const part of parts) {
        const textVar = makeId("text");
        if (part.kind === "static") {
          createStatements.push(
            `const ${textVar} = Dom.createText(${JSON.stringify(part.value)});`
          );
          if (parentVar) insertIntoDom(textVar, parentVar);
        } else {
          createStatements.push(`const ${textVar} = Dom.createText('');`);
          if (parentVar) insertIntoDom(textVar, parentVar);
          bindingList.push({ kind: "text", target: textVar, expr: part.value });
          importNames.add("bindText");
        }
        lastTextVar = textVar;
      }
      return lastTextVar;
    }

    // CONTROL-FLOW when current node is a host in siblings (m-if chain only)
    const attrsForPresence = node.attrs || {};
    if (parentVar && siblings && typeof index === "number") {
      if (hasIfDirective(attrsForPresence)) {
        useReactive();

        const { branches, consumedTo } = collectIfChain(siblings, index);
        const anchorVar = makeId("a_if_sib");
        const controllerVar = makeId("if_ctrl_sib");

        createStatements.push(`const ${anchorVar} = Dom.createAnchor('if');`);
        insertIntoDom(anchorVar, parentVar);

        const branchFactories = branches.map((b) => makeBlockFactory([b.node]));
        const ladder =
          branches
            .map((b, i) => {
              const pred = b.testExpr == null ? "true" : `(${b.testExpr})`;
              return `${i === 0 ? "if" : "else if"} (${pred}) __next = ${
                branchFactories[i]
              }(${parentVar}, ${anchorVar});`;
            })
            .join("\n        ") + `\n        else __next = null;`;

        mountStatements.push(
          `
{
  let ${controllerVar}: null | (()=>void) = null;
  const __run = effect(()=>{ let __next: null | (()=>void) = null;
    ${ladder}
    if (${controllerVar}) { try { ${controllerVar}(); } catch {} }
    ${controllerVar} = __next || null;
  });
  __stops.push(()=>{ stop(__run); if (${controllerVar}) { try { ${controllerVar}(); } catch {} } });
}`.trim()
        );

        void siblings[consumedTo];
        return parentVar;
      }
    }

    // NORMAL ELEMENT (includes host-driven m-switch with cases as CHILDREN)
    if (!node.tag) throw new CompilerError("Element node is missing tag name.");
    const elementVar = makeId("el");

    createStatements.push(
      `const ${elementVar} = Dom.createElement(${JSON.stringify(node.tag)});`
    );
    if (scopeAttr) {
      createStatements.push(
        `Dom.setAttr(${elementVar}, ${JSON.stringify(scopeAttr)}, "");`
      );
    }

    const normalizedAttrs = normalizeAttributes(node.attrs || {});
    const hasSwitchOnThisElement = hasSwitchDirective(normalizedAttrs);

    // Static & reactive attrs (skip control flow)
    for (const attrName of Object.keys(normalizedAttrs)) {
      if (CONTROL_FLOW_ATTRS.has(attrName)) continue;

      const rawValue = (normalizedAttrs as any)[attrName];
      if (strict && rawValue == null)
        throw new NullOrUndefinedError(
          `Attribute ${attrName} has nullish value.`
        );
      if (rawValue === undefined)
        throw new NullOrUndefinedError(
          `Attribute ${attrName} has undefined value.`
        );

      if (attrName === "m-text") {
        const textVar = makeId("text");
        createStatements.push(`const ${textVar} = Dom.createText('');`);
        insertIntoDom(textVar, elementVar);
        bindingList.push({ kind: "text", target: textVar, expr: rawValue });
        importNames.add("bindText");
        continue;
      }
      if (attrName === "m-class") {
        bindingList.push({ kind: "class", target: elementVar, expr: rawValue });
        importNames.add("bindClass");
        continue;
      }
      if (attrName === "m-style") {
        bindingList.push({ kind: "style", target: elementVar, expr: rawValue });
        importNames.add("bindStyle");
        continue;
      }
      if (attrName === "m-show") {
        bindingList.push({ kind: "show", target: elementVar, expr: rawValue });
        importNames.add("bindShow");
        continue;
      }

      if (attrName.startsWith("@")) {
        const { type } = parseEventAttribute(attrName);
        bindingList.push({
          kind: "event",
          target: elementVar,
          type,
          handler: rawValue,
        });
        importNames.add("onEvent");
        continue;
      }
      if (attrName.startsWith("m-")) {
        const plain = attrName.slice(2);
        if (!plain)
          throw new CompilerError("m- attribute must have a name, e.g., m-id");
        bindingList.push({
          kind: "attr",
          target: elementVar,
          name: plain,
          expr: rawValue,
        });
        importNames.add("bindAttr");
        continue;
      }

      createStatements.push(
        `Dom.setAttr(${elementVar}, ${JSON.stringify(
          attrName
        )}, ${JSON.stringify(rawValue)});`
      );
    }

    // If this element is an m-switch host, handle cases among its CHILDREN now.
    if (hasSwitchOnThisElement) {
      useReactive();
      const switchOn = (normalizedAttrs as any)["m-switch"] as string;
      if (typeof switchOn !== "string" || switchOn.trim().length === 0) {
        throw new CompilerError("m-switch requires a non-empty expression.");
      }

      const cases = collectSwitchFromChildren(node.children);
      const anchorVar = makeId("a_sw_self");
      const controllerVar = makeId("sw_ctrl_self");

      // anchor belongs to this element — avoids insertBefore errors
      createStatements.push(`const ${anchorVar} = Dom.createAnchor('switch');`);
      insertIntoDom(anchorVar, elementVar);

      const factories = cases.map((c) => makeBlockFactory([c.node]));
      const ladder = buildSwitchIfElse(
        cases,
        switchOn.trim(),
        factories,
        elementVar,
        anchorVar
      );

      mountStatements.push(
        `
{
  let ${controllerVar}: null | (()=>void) = null;
  const __run = effect(()=>{ let __next: null | (()=>void) = null;
    ${ladder}
    if (${controllerVar}) { try { ${controllerVar}(); } catch {} }
    ${controllerVar} = __next || null;
  });
  __stops.push(()=>{ stop(__run); if (${controllerVar}) { try { ${controllerVar}(); } catch {} } });
}`.trim()
      );

      // This element's "cases" are fully handled; skip normal child walk.
    } else {
      // Normal children (support nested chains on children)
      for (
        let childIndex = 0;
        childIndex < node.children.length;
        childIndex++
      ) {
        const childNode = node.children[childIndex];
        if (!childNode) continue;
        // Child starts its own m-if chain (siblings within current element)
        if (childNode.type === "el" && hasIfDirective(childNode.attrs ?? {})) {
          useReactive();
          const { branches, consumedTo } = collectIfChain(
            node.children,
            childIndex
          );

          const anchorVar = makeId("a_if_child");
          const controllerVar = makeId("if_ctrl_child");
          createStatements.push(
            `const ${anchorVar} = Dom.createAnchor('if-child');`
          );
          insertIntoDom(anchorVar, elementVar);

          const factories = branches.map((b) => makeBlockFactory([b.node]));
          const ladder =
            branches
              .map((b, idx) => {
                const pred = b.testExpr == null ? "true" : `(${b.testExpr})`;
                return `${idx === 0 ? "if" : "else if"} (${pred}) __next = ${
                  factories[idx]
                }(${elementVar}, ${anchorVar});`;
              })
              .join("\n      ") + `\n      else __next = null;`;

          mountStatements.push(
            `
{
  let ${controllerVar}: null | (()=>void) = null;
  const __run = effect(()=>{ let __next: null | (()=>void) = null;
    ${ladder}
    if (${controllerVar}) { try { ${controllerVar}(); } catch {} }
    ${controllerVar} = __next || null;
  });
  __stops.push(()=>{ stop(__run); if (${controllerVar}) { try { ${controllerVar}(); } catch {} } });
}`.trim()
          );

          childIndex = consumedTo;
          continue;
        }

        // Guard: if a child is NOT starting a chain, it must not be a dangling branch.
        if (childNode.type === "el") {
          const ca = childNode.attrs ?? {};
          if (isElseLike(ca)) {
            throw new CompilerError(
              "m-else / m-else-if must follow an m-if chain."
            );
          }
          if (isCaseLike(ca)) {
            // Cases are only valid inside a switch host; if we reached here it's dangling.
            throw new CompilerError(
              "m-case / m-default must follow an m-switch host."
            );
          }
        }

        // Normal recursion
        // const childVar = walkTemplate(
        //   childNode,
        //   elementVar,
        //   node.children,
        //   childIndex
        // );
        // if (childNode.type === "el") insertIntoDom(childVar, elementVar);
        void walkTemplate(childNode, elementVar, node.children, childIndex);
      }
    }

    if (parentVar) insertIntoDom(elementVar, parentVar);
    return elementVar;
  };

  // ROOTS
  for (let rootIndex = 0; rootIndex < rootAst.length; rootIndex++) {
    const rootNode = rootAst[rootIndex];
    if (!rootNode) continue;
    if (rootNode.type === "el") {
      const rootAttrs = rootNode.attrs ?? {};

      // root dangling guards
      if (isElseLike(rootAttrs)) {
        throw new CompilerError(
          "m-else / m-else-if must follow an m-if chain."
        );
      }
      if (isCaseLike(rootAttrs)) {
        throw new CompilerError(
          "m-case / m-default must follow an m-switch host."
        );
      }

      // root m-if chain
      if (hasIfDirective(rootAttrs)) {
        useReactive();
        const { branches, consumedTo } = collectIfChain(rootAst, rootIndex);

        const anchorVar = makeId("a_if_root");
        const controllerVar = makeId("if_ctrl_root");
        createStatements.push(
          `const ${anchorVar} = Dom.createAnchor('if-root');`
        );
        mountStatements.push(
          `Dom.insert(${anchorVar}, target, anchor ?? null);`
        );

        const factories = branches.map((b) => makeBlockFactory([b.node]));
        const ladder =
          branches
            .map((b, i) => {
              const pred = b.testExpr == null ? "true" : `(${b.testExpr})`;
              return `${i === 0 ? "if" : "else if"} (${pred}) __next = ${
                factories[i]
              }(target, ${anchorVar});`;
            })
            .join("\n      ") + `\n      else __next = null;`;

        mountStatements.push(
          `
{
  let ${controllerVar}: null | (()=>void) = null;
  const __run = effect(()=>{ let __next: null | (()=>void) = null;
    ${ladder}
    if (${controllerVar}) { try { ${controllerVar}(); } catch {} }
    ${controllerVar} = __next || null;
  });
  __stops.push(()=>{ stop(__run); if (${controllerVar}) { try { ${controllerVar}(); } catch {} } });
}`.trim()
        );

        rootIndex = consumedTo;
        continue;
      }

      // root normal element (including host-driven switch inside)
    }
    if (!rootNode) continue;
    const resultVar = walkTemplate(rootNode);
    if (rootNode.type === "el") {
      mountStatements.push(`Dom.insert(${resultVar}, target, anchor ?? null);`);
    }
  }

  return {
    file,
    name,
    create: createStatements,
    mount: mountStatements,
    bindings: bindingList,
    imports: Array.from(importNames),
  };
}

/** SFC entry */
export function compileSFC(source: string, file: string): { code: string } {
  const sfc = parseSFC(source, file);
  const ir = compileTemplateToIR(sfc.template, {
    file,
    name: toComponentName(file),
  });
  const jsComponent = generateComponent(ir);
  const userScript = transpileScript(sfc.script, file);
  return { code: userScript ? `${userScript}\n\n${jsComponent}` : jsComponent };
}

function toComponentName(filePath: string): string {
  const base = (filePath.split(/[\\/]/).pop() || "Component").replace(
    /\.[^.]+$/,
    ""
  );
  if (!base)
    throw new CompilerError("Unable to derive component name from file path.");
  return base;
}
