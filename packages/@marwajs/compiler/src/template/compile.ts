import type { ComponentIR, Binding } from "../ir";

type Node =
  | { type: "el"; tag: string; attrs: Record<string, string>; children: Node[] }
  | { type: "text"; value: string };

// Behavior modifiers passed to withModifiers
const BEHAVIOR_MODS = new Set<string>([
  "stop",
  "prevent",
  "self",
  "once",
  "capture",
  "passive",
]);

// Key modifier → DOM e.key values
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
  const extraImports = new Set<string>(); // runtime helpers used inside inline blocks

  let id = 0;
  const vid = (p: string) => `_${p}${++id}`;

  function compileTextExpr(raw: string): string | null {
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
    if (!parts.length && !tail) return null;
    if (tail) parts.push(tail.replace(/`/g, "\\`"));
    if (parts.length === 1 && !/\$\{/.test(parts[0])) return null;
    return "`" + parts.join("") + "`";
  }

  // ----- inline Block factory for :if branches -----
  function emitBlockFactory(children: Node[]): string {
    let local = 0;
    const lid = (p: string) => `__b_${p}${++local}`;

    const linesCreate: string[] = [];
    const linesMount: string[] = [];
    const linesBindings: string[] = [];

    function use(name: string) {
      extraImports.add(name);
    }

    function walkInline(n: Node, parentVar: string) {
      if (n.type === "text") {
        const expr = compileTextExpr(n.value);
        const t = lid("t");
        linesCreate.push(
          `const ${t} = Dom.createText(${
            expr ? "''" : JSON.stringify(n.value)
          });`
        );
        linesMount.push(`Dom.insert(${t}, ${parentVar});`);
        if (expr) {
          use("bindText");
          linesBindings.push(`__stops.push(bindText(${t}, () => (${expr})));`);
        }
        return;
      }

      const el = lid("e");
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
          const tn = lid("t");
          linesCreate.push(`const ${tn} = Dom.createText('');`);
          linesMount.push(`Dom.insert(${tn}, ${el});`);
          use("bindText");
          linesBindings.push(`__stops.push(bindText(${tn}, () => (${v})));`);
          continue;
        }
        if (k === ":class") {
          use("bindClass");
          linesBindings.push(`__stops.push(bindClass(${el}, () => (${v})));`);
          continue;
        }
        if (k === ":style") {
          use("bindStyle");
          linesBindings.push(`__stops.push(bindStyle(${el}, () => (${v})));`);
          continue;
        }
        if (k === ":show") {
          use("bindShow");
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

          use("bindModel");
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
            use("withModifiers");
            handler = `withModifiers(${handler}, [${behaviorMods
              .map((m) => `'${m}'`)
              .join(",")}])`;
          }
          use("onEvent");
          linesBindings.push(
            `__stops.push(onEvent(ctx.app, ${el}, ${JSON.stringify(
              type
            )}, ${handler}));`
          );
          continue;
        }

        if (k.startsWith(":")) {
          const name = k.slice(1);
          use("bindAttr");
          linesBindings.push(
            `__stops.push(bindAttr(${el}, ${JSON.stringify(
              name
            )}, () => (${v})));`
          );
          continue;
        }

        linesCreate.push(
          `Dom.setAttr(${el}, ${JSON.stringify(k)}, ${JSON.stringify(v)});`
        );
      }

      for (const c of n.children) walkInline(c, el);
      linesMount.push(`Dom.insert(${el}, ${parentVar});`);
    }

    const anchor = lid("a");
    linesCreate.unshift(`const ${anchor} = Dom.createAnchor('if-block');`);

    for (const ch of children) walkInline(ch, "parent");

    return `() => {
  const __stops = [];
  ${linesCreate.join("\n  ")}
  return {
    el: ${anchor},
    mount(parent, anchorNode) {
      Dom.insert(${anchor}, parent, anchorNode ?? null);
      ${linesMount.join("\n      ")}
      ${linesBindings.join("\n      ")}
    },
    destroy() {
      for (let i = __stops.length - 1; i >= 0; i--) { try { __stops[i](); } catch {} }
      Dom.remove(${anchor});
    }
  };
}`;
  }

  // Build a nested bindIf chain for conds/branches mounted into `parentExpr`
  function buildIfChain(
    parentExpr: string,
    conds: string[],
    branches: Node[][]
  ): string {
    extraImports.add("bindIf");

    function makeElseFactory(startIdx: number): string {
      const a = `__nest_a_${++id}`;
      const stop = `__nest_stop_${id}`;
      const chain = buildIfChain(
        "parent",
        conds.slice(startIdx),
        branches.slice(startIdx)
      );
      return `() => {
  let ${stop};
  const ${a} = Dom.createAnchor('if-nest');
  return {
    el: ${a},
    mount(parent, anchorNode) {
      Dom.insert(${a}, parent, anchorNode ?? null);
      ${stop} = ${chain};
    },
    destroy() {
      if (${stop}) ${stop}();
      Dom.remove(${a});
    }
  };
}`;
    }

    if (conds.length === 1) {
      const mk = emitBlockFactory(branches[0]);
      return `bindIf(${parentExpr}, () => (${conds[0]}), ${mk})`;
    } else {
      const mk0 = emitBlockFactory(branches[0]);
      const elseFactory = makeElseFactory(1);
      return `bindIf(${parentExpr}, () => (${conds[0]}), ${mk0}, ${elseFactory})`;
    }
  }

  // ---- main walker for regular nodes ----
  function walk(n: Node, parentVar?: string): string {
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

    // attributes & directives
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

    // children (two-phase: normal children first; defer :if clusters)
    {
      const deferredIfs: string[] = [];
      let i = 0;
      while (i < n.children.length) {
        const c = n.children[i];

        if (
          c.type === "el" &&
          c.tag === "template" &&
          typeof c.attrs[":if"] === "string"
        ) {
          const conds: string[] = [c.attrs[":if"]];
          const branches: Node[][] = [c.children];

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

          deferredIfs.push(buildIfChain(el, conds, branches));
          i = j;
          continue;
        }

        // normal child — let walk(c, el) emit its own insert
        walk(c, el);
        i++;
      }

      for (const expr of deferredIfs) {
        mount.push(`__stops.push(${expr});`);
      }
    }

    if (parentVar) mount.push(`Dom.insert(${el}, ${parentVar});`);
    return el;
  }

  // top-level traversal: insert normal roots first, then root :if chains
  const roots: string[] = [];
  const deferredRootIfs: string[] = [];

  let ri = 0;
  while (ri < ast.length) {
    const n = ast[ri];

    if (
      n.type === "el" &&
      n.tag === "template" &&
      typeof n.attrs[":if"] === "string"
    ) {
      const conds: string[] = [n.attrs[":if"]];
      const branches: Node[][] = [n.children];

      let j = ri + 1;
      while (j < ast.length) {
        const sib = ast[j];
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

      deferredRootIfs.push(buildIfChain("target", conds, branches));
      ri = j;
      continue;
    }

    const res = walk(n, undefined);
    if (n.type === "el") roots.push(res);
    ri++;
  }

  const rootMounts = roots.map(
    (r) => `Dom.insert(${r}, target, anchor ?? null);`
  );

  const ir: ComponentIR = {
    file,
    name,
    create,
    mount: [
      ...rootMounts,
      ...mount,
      ...deferredRootIfs.map((e) => `__stops.push(${e});`),
    ],
    bindings,
  };

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
