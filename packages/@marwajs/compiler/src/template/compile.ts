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

  // Track extra runtime imports required by inline factories / control flow
  const extraImports = new Set<string>();
  const use = (n: string) => extraImports.add(n);
  use("Dom"); // always used by compiler output

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

  // ---- inline factory emitter for :if branches & :switch cases ----
  function emitBlockFactory(children: Node[]): string {
    use("Dom");

    const localId = (() => {
      let n = 0;
      return (p: string) => `__b_${p}${++n}`;
    })();

    const linesCreate: string[] = [];
    const linesMount: string[] = [];
    const linesBindings: string[] = [];

    //let ROOT = "";

    function insertLine(childVar: string, parentVar: string) {
      if (parentVar === ROOT) {
        linesMount.push(`Dom.insert(${childVar}, ${parentVar}, __a);`);
      } else {
        linesMount.push(`Dom.insert(${childVar}, ${parentVar});`);
      }
    }

    function walkInline(n: Node, parentVar: string) {
      if (n.type === "text") {
        const expr = compileTextExpr(n.value);
        const t = localId("t");
        linesCreate.push(
          `const ${t} = Dom.createText(${
            expr ? "''" : JSON.stringify(n.value)
          });`
        );
        insertLine(t, parentVar);
        if (expr) {
          linesBindings.push(`__stops.push(bindText(${t}, () => (${expr})));`);
          use("bindText");
        }
        return;
      }

      const el = localId("e");
      linesCreate.push(
        `const ${el} = Dom.createElement(${JSON.stringify(n.tag)});`
      );
      if (scopeAttr) {
        linesCreate.push(
          `Dom.setAttr(${el}, ${JSON.stringify(scopeAttr)}, "");`
        );
      }

      const attrs = n.attrs || {};
      for (const k in attrs) {
        const v = attrs[k];

        if (k === ":text") {
          const tn = localId("t");
          linesCreate.push(`const ${tn} = Dom.createText('');`);
          linesMount.push(`Dom.insert(${tn}, ${el});`);
          linesBindings.push(`__stops.push(bindText(${tn}, () => (${v})));`);
          use("bindText");
          continue;
        }
        if (k === ":class") {
          linesBindings.push(`__stops.push(bindClass(${el}, () => (${v})));`);
          use("bindClass");
          continue;
        }
        if (k === ":style") {
          linesBindings.push(`__stops.push(bindStyle(${el}, () => (${v})));`);
          use("bindStyle");
          continue;
        }
        if (k === ":show") {
          linesBindings.push(`__stops.push(bindShow(${el}, () => !!(${v})));`);
          use("bindShow");
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
          use("bindModel");
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
            )}).includes(e.key)) return; ${v} }`;
          }
          if (behaviorMods.length) {
            handler = `withModifiers(${handler}, [${behaviorMods
              .map((m) => `'${m}'`)
              .join(",")}])`;
            use("withModifiers");
          }
          linesBindings.push(
            `__stops.push(onEvent(ctx.app, ${el}, ${JSON.stringify(
              type
            )}, ${handler}));`
          );
          use("onEvent");
          continue;
        }

        if (k.startsWith(":")) {
          const name = k.slice(1);
          linesBindings.push(
            `__stops.push(bindAttr(${el}, ${JSON.stringify(
              name
            )}, () => (${v})));`
          );
          use("bindAttr");
          continue;
        }

        linesCreate.push(
          `Dom.setAttr(${el}, ${JSON.stringify(k)}, ${JSON.stringify(v)});`
        );
      }

      for (const c of n.children) walkInline(c, el);

      insertLine(el, parentVar);
    }

    const rootContainer = localId("frag");
    const anchor = localId("a");
    let ROOT = rootContainer;

    const mountHeader = [
      `Dom.insert(${anchor}, parent, anchorNode ?? null);`,
      `const ${rootContainer} = parent;`,
      `const __a = anchorNode ?? null;`,
    ];

    const destroyFooter = [
      `for (let i = __stops.length - 1; i >= 0; i--) { try { __stops[i](); } catch {} }`,
      `Dom.remove(${anchor});`,
    ];

    for (const ch of children) walkInline(ch, rootContainer);

    return `() => {
  const __stops = [];
  const ${anchor} = Dom.createAnchor('block');
  ${linesCreate.join("\n  ")}
  return {
    el: ${anchor},
    mount(parent, anchorNode) {
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

  // ---- helper: empty block factory (no-op) ----
  function emitEmptyBlockFactory(label = "empty") {
    return `() => ({ el: Dom.createAnchor(${JSON.stringify(
      label
    )}), mount(){}, destroy(){} })`;
  }

  // ---- helper: reactive chain for else-if branches (existing behavior) ----
  function emitIfChainFactory(
    conds: string[],
    makeFns: string[],
    start: number
  ): string | undefined {
    use("bindIf");
    use("Dom");

    const last = conds.length - 1;
    if (start > last) return undefined;

    if (start === last && conds[start] === "true") {
      return makeFns[start];
    }

    if (start === last) {
      const thenF = makeFns[start];
      const empty = emitEmptyBlockFactory("if-empty");
      return `() => {
  const __stops = [];
  const __anchor = Dom.createAnchor('if-chain');
  return {
    el: __anchor,
    mount(parent, anchorNode) {
      Dom.insert(__anchor, parent, anchorNode ?? null);
      __stops.push(bindIf(parent, () => (${conds[start]}), ${thenF}, ${empty}));
    },
    destroy() {
      for (let i = __stops.length - 1; i >= 0; i--) { try { __stops[i](); } catch {} }
      Dom.remove(__anchor);
    }
  };
}`;
    }

    const thenF = makeFns[start];
    const elseF =
      emitIfChainFactory(conds, makeFns, start + 1) ?? emitEmptyBlockFactory();

    return `() => {
  const __stops = [];
  const __anchor = Dom.createAnchor('if-chain');
  return {
    el: __anchor,
    mount(parent, anchorNode) {
      Dom.insert(__anchor, parent, anchorNode ?? null);
      __stops.push(bindIf(parent, () => (${conds[start]}), ${thenF}, ${elseF}));
    },
    destroy() {
      for (let i = __stops.length - 1; i >= 0; i--) { try { __stops[i](); } catch {} }
      Dom.remove(__anchor);
    }
  };
}`;
  }

  // ---- NEW: compile a <template :switch="expr"> cluster into bindSwitch(...) ----
  function compileSwitchCluster(
    switchExpr: string,
    siblings: Node[],
    startIndex: number,
    parentVar: string
  ): { consumedTo: number } {
    use("bindSwitch");

    // Collect consecutive <template :case> and optional <template :default>
    const branches: { when: string; factory: string }[] = [];
    let elseFactory: string | null = null;

    let j = startIndex + 1;
    while (j < siblings.length) {
      const sib = siblings[j];
      if (sib.type !== "el" || sib.tag !== "template") break;

      const hasCase = Object.prototype.hasOwnProperty.call(sib.attrs, ":case");
      const hasDefault = Object.prototype.hasOwnProperty.call(
        sib.attrs,
        ":default"
      );

      if (!hasCase && !hasDefault) break;

      if (hasCase) {
        const caseExpr = (sib.attrs[":case"] ?? "").trim();
        const f = emitBlockFactory(sib.children);
        // when: () => ((switchExpr) === (caseExpr))
        branches.push({
          when: `() => ((${switchExpr}) === (${caseExpr}))`,
          factory: f,
        });
        j++;
        continue;
      }

      if (hasDefault) {
        elseFactory = emitBlockFactory(sib.children);
        j++;
        break; // default must be last we care about
      }
    }

    // Emit bindSwitch call
    if (branches.length === 0 && !elseFactory) {
      // No usable branches; nothing to mount
      return { consumedTo: startIndex };
    }

    const arrayLiteral = `[${branches
      .map((b) => `{ when: ${b.when}, factory: ${b.factory} }`)
      .join(", ")}]`;

    if (elseFactory) {
      mount.push(
        `__stops.push(bindSwitch(${parentVar}, ${arrayLiteral}, ${elseFactory}));`
      );
    } else {
      mount.push(`__stops.push(bindSwitch(${parentVar}, ${arrayLiteral}));`);
    }

    return { consumedTo: j - 1 };
  }

  // ---- main walker with support for <template :if>, :else-if, :else and NEW :switch ----
  function walk(
    n: Node,
    parentVar?: string,
    siblings?: Node[],
    idx?: number
  ): string {
    // Handle <template :if> cluster at same level
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

      // consume following :else-if / :else
      let j = idx + 1;
      while (j < siblings.length) {
        const sib = siblings[j];
        if (sib.type !== "el" || sib.tag !== "template") break;
        const hasElseIf = typeof (sib as any).attrs[":else-if"] === "string";
        const hasElse = Object.prototype.hasOwnProperty.call(
          (sib as any).attrs,
          ":else"
        );
        if (!hasElseIf && !hasElse) break;
        if (hasElseIf) {
          conds.push((sib as any).attrs[":else-if"]);
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

      use("bindIf");

      const makeFns = branches.map((b) => emitBlockFactory(b));
      const thenFactory = makeFns[0];
      const elseChainFactory =
        emitIfChainFactory(conds, makeFns, 1) ?? emitEmptyBlockFactory();

      mount.push(
        `__stops.push(bindIf(${parentVar}, () => (${conds[0]}), ${thenFactory}, ${elseChainFactory}));`
      );
      return parentVar;
    }

    // Handle <template :switch="..."> cluster at same level
    if (
      n.type === "el" &&
      n.tag === "template" &&
      typeof n.attrs[":switch"] === "string" &&
      parentVar &&
      siblings &&
      typeof idx === "number"
    ) {
      const switchExpr = n.attrs[":switch"];
      // Compile its own children? In switch semantics, direct children are ignored;
      // only following siblings with :case / :default define branches.
      const { consumedTo } = compileSwitchCluster(
        switchExpr,
        siblings,
        idx,
        parentVar
      );
      // Skip consumed siblings (:case / :default)
      return siblings[consumedTo] ? ((idx = consumedTo), parentVar) : parentVar;
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
          )}).includes(e.key)) return; ${v} }`;
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

    // === children (cluster-aware) ===
    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i];

      // Handle nested <template :if> cluster
      if (
        c.type === "el" &&
        c.tag === "template" &&
        typeof c.attrs[":if"] === "string"
      ) {
        void walk(c, el, n.children, i);
        // Skip following :else-if / :else siblings in this cluster
        let j = i + 1;
        while (j < n.children.length) {
          const sib = n.children[j];
          if (sib.type !== "el" || sib.tag !== "template") break;
          const hasElseIf = typeof sib.attrs[":else-if"] === "string";
          const hasElse = Object.prototype.hasOwnProperty.call(
            sib.attrs,
            ":else"
          );
          if (!hasElseIf && !hasElse) break;
          j++;
        }
        i = j - 1;
        continue;
      }

      // Handle nested <template :switch> cluster
      if (
        c.type === "el" &&
        c.tag === "template" &&
        typeof c.attrs[":switch"] === "string"
      ) {
        const { consumedTo } = compileSwitchCluster(
          c.attrs[":switch"],
          n.children,
          i,
          el
        );
        i = consumedTo; // skip consumed :case/:default siblings
        continue;
      }

      // Normal child
      const res = walk(c, el, n.children, i);
      if (c.type === "el") {
        mount.push(`Dom.insert(${res}, ${el});`);
      }
    }

    if (parentVar) mount.push(`Dom.insert(${el}, ${parentVar});`);
    return el;
  }

  // === top-level cluster-aware ===
  const roots: string[] = [];
  for (let i = 0; i < ast.length; i++) {
    const n = ast[i];

    // Top-level :if cluster
    if (
      n.type === "el" &&
      n.tag === "template" &&
      typeof n.attrs[":if"] === "string"
    ) {
      void walk(n, "target" as any, ast, i);

      let j = i + 1;
      while (j < ast.length) {
        const sib = ast[j];
        if (sib.type !== "el" || sib.tag !== "template") break;
        const hasElseIf = typeof sib.attrs[":else-if"] === "string";
        const hasElse = Object.prototype.hasOwnProperty.call(
          sib.attrs,
          ":else"
        );
        if (!hasElseIf && !hasElse) break;
        j++;
      }
      i = j - 1;
      continue;
    }

    // Top-level :switch cluster
    if (
      n.type === "el" &&
      n.tag === "template" &&
      typeof n.attrs[":switch"] === "string"
    ) {
      compileSwitchCluster(n.attrs[":switch"], ast, i, "target" as any);
      // Skip :case / :default siblings
      let j = i + 1;
      while (j < ast.length) {
        const sib = ast[j];
        if (sib.type !== "el" || sib.tag !== "template") break;
        const hasCase = Object.prototype.hasOwnProperty.call(
          sib.attrs,
          ":case"
        );
        const hasDefault = Object.prototype.hasOwnProperty.call(
          sib.attrs,
          ":default"
        );
        if (!hasCase && !hasDefault) break;
        j++;
      }
      i = j - 1;
      continue;
    }

    const res = walk(n, undefined, ast, i);
    if (n.type === "el") {
      if (
        !(n.tag === "template" && (":if" in n.attrs || ":switch" in n.attrs))
      ) {
        roots.push(res);
      }
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

  // pass extra imports (e.g., bindIf, bindText, bindSwitch used inside inline factories)
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
