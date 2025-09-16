import type { ComponentIR, Binding } from "../ir";

type Node =
  | { type: "el"; tag: string; attrs: Record<string, string>; children: Node[] }
  | { type: "text"; value: string };

// Behavior modifiers we pass through to withModifiers
const BEHAVIOR_MODS = new Set<string>([
  "stop",
  "prevent",
  "self",
  "once",
  "capture",
  "passive",
]);

// Map key modifiers to DOM e.key values
const KEY_MODS: Record<string, string[]> = {
  enter: ["Enter"],
  esc: ["Escape"],
  escape: ["Escape"],
  space: [" ", "Spacebar"],
  tab: ["Tab"],
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  delete: ["Delete"],
  backspace: ["Backspace"],
};

export function compileTemplateToIR(
  html: string,
  { file, name, scopeAttr }: { file: string; name: string; scopeAttr?: string }
): ComponentIR {
  const ast = parseHTML(html);
  const create: string[] = [];
  const mount: string[] = [];
  const bindings: Binding[] = [];
  const extraImports = new Set<string>(); // <- to request runtime imports (e.g. bindIf)

  let id = 0;
  const vid = (p: string) => `_${p}${++id}`;

  function compileTextExpr(raw: string): string | null {
    // Split by {{ expr }} and return a template literal expression
    const re = /\{\{\s*([^}]+?)\s*\}\}/g;
    let last = 0;
    let m: RegExpExecArray | null;
    const parts: string[] = [];
    while ((m = re.exec(raw))) {
      const staticPart = raw.slice(last, m.index);
      if (staticPart) parts.push(staticPart.replace(/`/g, "\\`"));
      parts.push(`\${(${m[1]})}`);
      last = m.index + m[0].length;
    }
    const tail = raw.slice(last);
    if (!parts.length && !tail) return null; // no dynamic
    if (tail) parts.push(tail.replace(/`/g, "\\`"));
    if (parts.length === 1 && !/\$\{/.test(parts[0])) return null;
    return "`" + parts.join("") + "`";
  }

  // ---- inline factory emitter for :if branches ----
  function emitBlockFactory(children: Node[]): string {
    const localId = (() => {
      let n = 0;
      return (p: string) => `__b_${p}${++n}`;
    })();

    // We produce a factory that returns a Block:
    // { el, mount(parent, anchor), patch?(), destroy() }
    // It builds nodes on mount to avoid leaking unused nodes when branch is off.
    const linesCreate: string[] = [];
    const linesMount: string[] = [];
    const linesDestroy: string[] = [];
    const linesBindings: string[] = [];

    function walkInline(n: Node, parentVar: string) {
      if (n.type === "text") {
        const expr = compileTextExpr(n.value);
        const t = localId("t");
        linesCreate.push(
          `const ${t} = Dom.createText(${
            expr ? "''" : JSON.stringify(n.value)
          });`
        );
        linesMount.push(`Dom.insert(${t}, ${parentVar});`);
        if (expr)
          linesBindings.push(`__stops.push(bindText(${t}, () => (${expr})));`);
        return;
      }

      const el = localId("e");
      linesCreate.push(
        `const ${el} = Dom.createElement(${JSON.stringify(n.tag)});`
      );
      if (scopeAttr)
        linesCreate.push(
          `Dom.setAttr(${el}, ${JSON.stringify(scopeAttr)}, "");`
        );

      // attrs for inline block (same logic as main walk, but emit to *local* arrays)
      const attrs = n.attrs || {};
      for (const k in attrs) {
        const v = attrs[k];

        if (k === ":text") {
          const tn = localId("t");
          linesCreate.push(`const ${tn} = Dom.createText('');`);
          linesMount.push(`Dom.insert(${tn}, ${el});`);
          linesBindings.push(`__stops.push(bindText(${tn}, () => (${v})));`);
          continue;
        }
        if (k === ":class") {
          linesBindings.push(`__stops.push(bindClass(${el}, () => (${v})));`);
          continue;
        }
        if (k === ":style") {
          linesBindings.push(`__stops.push(bindStyle(${el}, () => (${v})));`);
          continue;
        }
        if (k === ":show") {
          linesBindings.push(`__stops.push(bindShow(${el}, () => !!(${v})));`);
          continue;
        }

        if (k.startsWith("m-model")) {
          const [, ...mods] = k.split(".");
          const opts: any = {};
          if (mods.includes("number")) opts.number = true;
          if (mods.includes("trim")) opts.trim = true;
          if (mods.includes("lazy")) opts.lazy = true;

          const model = v.trim();
          const isRef = /\.value$/.test(model);
          const getExpr = isRef ? model : `${model}()`;
          const setExpr = isRef ? `${model} = $_` : `${model}.set($_)`;
          linesBindings.push(
            `__stops.push(bindModel(ctx.app, ${el}, () => (${getExpr}), (v) => (${setExpr.replace(
              /\$_/g,
              "v"
            )}), ${JSON.stringify(opts)}));`
          );
          continue;
        }

        if (k.startsWith("@")) {
          const raw = k.slice(1);
          const parts = raw.split(".");
          const type = parts.shift()!;
          const behaviorMods = parts.filter((m) => BEHAVIOR_MODS.has(m));
          const keyMods = parts.filter((m) =>
            Object.prototype.hasOwnProperty.call(KEY_MODS, m)
          );

          let handler = `(e)=>{ ${v} }`;
          if (keyMods.length) {
            const condKeys = keyMods.map((km) => KEY_MODS[km]).flat();
            handler = `(e)=>{ if (!(${JSON.stringify(
              condKeys
            )}.includes(e.key))) return; ${v} }`;
          }
          if (behaviorMods.length) {
            handler = `withModifiers(${handler}, [${behaviorMods
              .map((m) => `'${m}'`)
              .join(",")}])`;
          }
          linesBindings.push(
            `__stops.push(onEvent(ctx.app, ${el}, ${JSON.stringify(
              type
            )}, ${handler}));`
          );
          continue;
        }

        if (k.startsWith(":")) {
          const name = k.slice(1);
          linesBindings.push(
            `__stops.push(bindAttr(${el}, ${JSON.stringify(
              name
            )}, () => (${v})));`
          );
          continue;
        }

        // static attr
        linesCreate.push(
          `Dom.setAttr(${el}, ${JSON.stringify(k)}, ${JSON.stringify(v)});`
        );
      }

      // children
      for (const c of n.children) {
        walkInline(c, el);
      }

      linesMount.push(`Dom.insert(${el}, ${parentVar});`);
    }

    const rootContainer = localId("frag"); // not a real fragment, just a marker var name
    // We'll insert nodes directly into parent; keep a marker 'el' anchor for Block
    const anchor = localId("a");
    linesCreate.unshift(`const ${anchor} = Dom.createAnchor('if-block');`);
    // mount inserts the anchor first; children follow
    const mountHeader = [
      `Dom.insert(${anchor}, parent, anchorNode ?? null);`,
      `const ${rootContainer} = parent;`,
    ];

    const destroyFooter = [
      `for (let i = __stops.length - 1; i >= 0; i--) { try { __stops[i](); } catch {} }`,
      `Dom.remove(${anchor});`,
    ];

    // walk all children into the local arrays
    for (const ch of children) {
      walkInline(ch, rootContainer);
    }

    return `() => {
  const __stops: any[] = [];
  ${linesCreate.join("\n  ")}
  return {
    el: ${anchor},
    mount(parent: Node, anchorNode?: Node | null) {
      ${mountHeader.join("\n      ")}
      ${linesMount.join("\n      ")}
      ${linesBindings.join("\n      ")}
    },
    destroy() {
      ${destroyFooter.join("\n      ")}
    }
  };
}`;
  }

  // ---- main walker with support for <template :if>, :else-if, :else ----
  function walk(
    n: Node,
    parentVar?: string,
    siblings?: Node[],
    idx?: number
  ): string {
    // Transform control flow: <template :if="..."> ... [<template :else-if="..."> ...]* [<template :else>...]?
    if (
      n.type === "el" &&
      n.tag === "template" &&
      n.attrs[":if"] &&
      parentVar &&
      siblings &&
      typeof idx === "number"
    ) {
      const thenChildren = n.children;
      const conds: string[] = [n.attrs[":if"]];
      const branches: Node[][] = [thenChildren];

      // consume subsequent else-if / else siblings
      let j = idx + 1;
      while (j < siblings.length) {
        const sib = siblings[j];
        if (sib.type !== "el" || sib.tag !== "template") break;
        const hasElseIf = typeof sib.attrs[":else-if"] === "string";
        const hasElse = Object.prototype.hasOwnProperty.call(
          sib.attrs,
          ":else"
        );
        if (!hasElseIf && !hasElse) break;
        if (hasElseIf) {
          conds.push(sib.attrs[":else-if"]);
          branches.push(sib.children);
          j++;
          continue;
        }
        if (hasElse) {
          conds.push("true");
          branches.push(sib.children);
          j++;
          break;
        }
      }

      // Build nested bindIf for conds, right-associated:
      // bindIf(parent, c0, make0, () => bindIf(parent, c1, make1, ...))
      extraImports.add("bindIf");
      const makeFns = branches.map((b) => emitBlockFactory(b));

      // Build nested lambda for else chain
      const nestedElse = (k: number): string => {
        if (k >= conds.length - 1) {
          return makeFns[k];
        }
        return `() => {
          return {
            el: Dom.createText(''), mount() {}, destroy() {}
          } as any; // unused
        }`;
      };

      // Synthesize nested bindIf calls
      // Starting from the last branch, fold into else of previous
      let elseExpr = "undefined";
      for (let p = conds.length - 1; p >= 0; p--) {
        const c = conds[p];
        const mk = makeFns[p];
        const elsePart =
          p === conds.length - 1 ? "undefined" : `() => ${elseExpr}`;
        elseExpr = `bindIf(${parentVar}, () => (${c}), ${mk}, ${elsePart})`;
      }

      mount.push(`__stops.push(${elseExpr});`);
      // we've consumed siblings up to j-1; caller will skip them by advancing index
      // return parentVar just as placeholder
      return parentVar;
    }

    if (n.type === "text") {
      if (!n.value || n.value.trim() === "") return parentVar || "";
      const expr = compileTextExpr(n.value);
      const t = vid("t");
      create.push(
        `const ${t} = Dom.createText(${expr ? "''" : JSON.stringify(n.value)});`
      );
      if (parentVar) mount.push(`Dom.insert(${t}, ${parentVar});`);
      if (expr) bindings.push({ kind: "text", target: t, expr });
      return t;
    }

    // element
    const el = vid("e");
    create.push(`const ${el} = Dom.createElement(${JSON.stringify(n.tag)});`);
    if (scopeAttr)
      create.push(`Dom.setAttr(${el}, ${JSON.stringify(scopeAttr)}, "");`);

    const attrs = n.attrs || {};
    for (const k in attrs) {
      const v = attrs[k];

      if (k === ":text") {
        const tn = vid("t");
        create.push(`const ${tn} = Dom.createText('');`);
        mount.push(`Dom.insert(${tn}, ${el});`);
        bindings.push({ kind: "text", target: tn, expr: v });
        continue;
      }

      if (k === ":class") {
        bindings.push({ kind: "class", target: el, expr: v });
        continue;
      }
      if (k === ":style") {
        bindings.push({ kind: "style", target: el, expr: v });
        continue;
      }
      if (k === ":show") {
        bindings.push({ kind: "show", target: el, expr: v });
        continue;
      }

      if (k.startsWith("m-model")) {
        const [, ...mods] = k.split(".");
        const opts: any = {};
        if (mods.includes("number")) opts.number = true;
        if (mods.includes("trim")) opts.trim = true;
        if (mods.includes("lazy")) opts.lazy = true;

        const model = v.trim();
        const isRef = /\.value$/.test(model);
        const getExpr = isRef ? model : `${model}()`;
        const setExpr = isRef ? `${model} = $_` : `${model}.set($_)`;

        bindings.push({
          kind: "model",
          target: el,
          get: getExpr,
          set: setExpr,
          options: opts,
        });
        continue;
      }

      if (k.startsWith("@")) {
        const raw = k.slice(1);
        const parts = raw.split(".");
        const type = parts.shift()!;
        const behaviorMods = parts.filter((m) => BEHAVIOR_MODS.has(m));
        const keyMods = parts.filter((m) =>
          Object.prototype.hasOwnProperty.call(KEY_MODS, m)
        );

        let handler = `(e)=>{ ${v} }`;
        if (keyMods.length) {
          const condKeys = keyMods.map((km) => KEY_MODS[km]).flat();
          handler = `(e)=>{ if (!(${JSON.stringify(
            condKeys
          )}.includes(e.key))) return; ${v} }`;
        }
        if (behaviorMods.length) {
          handler = `withModifiers(${handler}, [${behaviorMods
            .map((m) => `'${m}'`)
            .join(",")}])`;
        }
        bindings.push({ kind: "event", target: el, type, handler });
        continue;
      }

      if (k.startsWith(":")) {
        const name = k.slice(1);
        bindings.push({ kind: "attr", target: el, name, expr: v });
        continue;
      }

      create.push(
        `Dom.setAttr(${el}, ${JSON.stringify(k)}, ${JSON.stringify(v)});`
      );
    }

    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i];
      // allow control flow inside element children too
      const res = walk(c, el, n.children, i);
      if (c.type === "el" && !(c.tag === "template" && c.attrs[":if"])) {
        mount.push(`Dom.insert(${res}, ${el});`);
      }
    }

    if (parentVar) mount.push(`Dom.insert(${el}, ${parentVar});`);
    return el;
  }

  // top-level walk with sibling awareness for <template :if> clusters
  const roots: string[] = [];
  for (let i = 0; i < ast.length; i++) {
    const n = ast[i];
    const res = walk(n, undefined, ast, i);
    if (n.type === "el" && !(n.tag === "template" && n.attrs[":if"])) {
      roots.push(res);
    }
  }

  const rootMounts = roots.map(
    (r) => `Dom.insert(${r}, target, anchor ?? null);`
  );

  const ir: ComponentIR = {
    file,
    name,
    create,
    mount: [...rootMounts, ...mount],
    bindings,
  };

  // pass extra imports to codegen (e.g. bindIf)
  (ir as any).imports = Array.from(extraImports);

  return ir;
}

// --- minimal HTML tokenizer (keeps meaningful spaces) ---
function parseHTML(src: string): Node[] {
  const re = /<\/?([A-Za-z][\w-]*)([^>]*)>|([^<]+)/g;
  const attrRe = /([:@.\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=]+)))?/g;
  const stack: Node[] = [];
  const roots: Node[] = [];

  function push(n: Node) {
    const parent = stack[stack.length - 1];
    if (parent && parent.type === "el") parent.children.push(n);
    else roots.push(n);
  }

  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[3]) {
      const txt = m[3];
      if (txt && txt.trim() !== "") push({ type: "text", value: txt });
      continue;
    }
    const tag = m[1];
    const rawAttrs = m[2] ?? "";
    if (m[0][1] === "/") {
      while (stack.length) {
        const top = stack.pop()!;
        if (top.type === "el" && top.tag === tag) break;
      }
    } else {
      const attrs: Record<string, string> = {};
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(rawAttrs))) {
        const k = a[1];
        const v = a[2] ?? a[3] ?? a[4] ?? "";
        attrs[k] = v;
      }
      const el: Node = { type: "el", tag, attrs, children: [] };
      push(el);
      const selfClose = /\/\s*>$/.test(m[0]) || isVoid(tag);
      if (!selfClose) stack.push(el);
    }
  }
  return roots;
}

function isVoid(tag: string) {
  return /^(br|hr|img|input|meta|link|source|area|base|col|embed|param|track|wbr)$/i.test(
    tag
  );
}
