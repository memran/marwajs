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

  // ---- inline factory emitter for :if branches ----
  function emitBlockFactory(children: Node[]): string {
    // Ensure Dom is imported for factory code
    use("Dom");

    const localId = (() => {
      let n = 0;
      return (p: string) => `__b_${p}${++n}`;
    })();

    const linesCreate: string[] = [];
    const linesMount: string[] = [];
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
      if (scopeAttr)
        linesCreate.push(
          `Dom.setAttr(${el}, ${JSON.stringify(scopeAttr)}, "");`
        );

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
            )}.includes(e.key))) return; ${v} }`;
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

        // static attr
        linesCreate.push(
          `Dom.setAttr(${el}, ${JSON.stringify(k)}, ${JSON.stringify(v)});`
        );
      }

      for (const c of n.children) {
        walkInline(c, el);
      }

      linesMount.push(`Dom.insert(${el}, ${parentVar});`);
    }

    const rootContainer = localId("frag");
    const anchor = localId("a");
    linesCreate.unshift(`const ${anchor} = Dom.createAnchor('if-block');`);

    const mountHeader = [
      `Dom.insert(${anchor}, parent, anchorNode ?? null);`,
      `const ${rootContainer} = parent;`,
    ];

    const destroyFooter = [
      `for (let i = __stops.length - 1; i >= 0; i--) { try { __stops[i](); } catch {} }`,
      `Dom.remove(${anchor});`,
    ];

    for (const ch of children) {
      walkInline(ch, rootContainer);
    }

    // NOTE: no TS types in emitted JS below
    return `() => {
  const __stops = [];
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

  // ---- main walker with support for <template :if>, :else-if, :else ----
  function walk(
    n: Node,
    parentVar?: string,
    siblings?: Node[],
    idx?: number
  ): string {
    // Control flow cluster at same level
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

      // Prepare factories for each branch
      const makeFns = branches.map((b) => emitBlockFactory(b));

      // Fold from the end: else-most first
      let elseExpr = "undefined";
      for (let p = conds.length - 1; p >= 0; p--) {
        const c = conds[p];
        const mk = makeFns[p];
        const elsePart =
          p === conds.length - 1 ? "undefined" : `() => ${elseExpr}`;
        elseExpr = `bindIf(${parentVar}, () => (${c}), ${mk}, ${elsePart})`;
      }

      mount.push(`__stops.push(${elseExpr});`);
      // Return parent placeholder (no direct node var for templates)
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

    // === children (cluster-aware) ===
    for (let i = 0; i < n.children.length; i++) {
      //console.log(n.children[i]);

      const c = n.children[i];

      // Handle <template :if> cluster and skip its else-siblings
      if (
        c.type === "el" &&
        c.tag === "template" &&
        typeof c.attrs[":if"] === "string"
      ) {
        // Emit a single bindIf(...) for the cluster
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
        i = j - 1; // skip to last else/else-if
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

    // If an :if cluster appears at top-level, consume it and skip else-siblings
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

    const res = walk(n, undefined, ast, i);
    if (n.type === "el") {
      if (!(n.tag === "template" && ":if" in n.attrs)) {
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

  // pass extra imports (e.g., bindIf, bindText used inside inline factories)
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
