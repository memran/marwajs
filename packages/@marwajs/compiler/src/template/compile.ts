// packages/@marwajs/compiler/src/template/compile.ts
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

  // ---------- unified block factory (optionally parameterized) ----------
  function emitBlockFactory(
    children: Node[],
    paramNames: string[] = []
  ): string {
    use("Dom");

    const localId = (() => {
      let n = 0;
      return (p: string) => `__b_${p}${++n}`;
    })();

    const linesCreate: string[] = [];
    const linesMount: string[] = [];
    const linesBindings: string[] = [];

    function insertLine(childVar: string, parentVar: string, ROOT: string) {
      if (parentVar === ROOT) {
        linesMount.push(`Dom.insert(${childVar}, ${parentVar}, __a);`);
      } else {
        linesMount.push(`Dom.insert(${childVar}, ${parentVar});`);
      }
    }

    // ---- INLINE clusters (if / switch / for / mount) inside this block ----
    function collectIfClusterInline(
      siblings: Node[],
      startIndex: number
    ): {
      branches: { when: string; children: Node[] }[];
      elseChildren?: Node[];
      consumedTo: number;
    } {
      const first = siblings[startIndex] as any;
      const branches: { when: string; children: Node[] }[] = [];
      let elseChildren: Node[] | undefined;
      branches.push({
        when: `() => ((${first.attrs[":if"]}))`,
        children: first.children,
      });
      let j = startIndex + 1;
      while (j < siblings.length) {
        const sib = siblings[j] as any;
        if (sib.type !== "el" || sib.tag !== "template") break;
        const hasElseIf = typeof sib.attrs[":else-if"] === "string";
        const hasElse = Object.prototype.hasOwnProperty.call(
          sib.attrs,
          ":else"
        );
        if (!hasElseIf && !hasElse) break;
        if (hasElseIf) {
          branches.push({
            when: `() => ((${sib.attrs[":else-if"]}))`,
            children: sib.children,
          });
          j++;
          continue;
        }
        if (hasElse) {
          elseChildren = sib.children;
          j++;
          break;
        }
      }
      return { branches, elseChildren, consumedTo: j - 1 };
    }

    function collectSwitchClusterInline(
      switchExpr: string,
      siblings: Node[],
      startIndex: number
    ): {
      branches: { when: string; children: Node[] }[];
      elseChildren?: Node[];
      consumedTo: number;
    } {
      const branches: { when: string; children: Node[] }[] = [];
      let elseChildren: Node[] | undefined;
      let j = startIndex + 1;
      while (j < siblings.length) {
        const sib = siblings[j] as any;
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
        if (hasCase) {
          const c = (sib.attrs[":case"] ?? "").trim();
          branches.push({
            when: `() => (((${switchExpr})) === ((${c})))`,
            children: sib.children,
          });
          j++;
          continue;
        }
        if (hasDefault) {
          elseChildren = sib.children;
          j++;
          break;
        }
      }
      return { branches, elseChildren, consumedTo: j - 1 };
    }

    function inlineEmitSwitchCall(
      parentVar: string,
      branches: { when: string; children: Node[] }[],
      elseChildren?: Node[]
    ) {
      use("bindSwitch");
      const arr = `[${branches
        .map(
          (b) =>
            `{ when: (${b.when}), factory: (${emitBlockFactory(b.children)}) }`
        )
        .join(", ")}]`;
      if (elseChildren && elseChildren.length) {
        const ef = emitBlockFactory(elseChildren);
        linesBindings.push(
          `__stops.push(bindSwitch(${parentVar}, ${arr}, ${ef}));`
        );
      } else {
        linesBindings.push(`__stops.push(bindSwitch(${parentVar}, ${arr}));`);
      }
    }

    // === :for (inline) ===
    function inlineEmitFor(parentVar: string, node: any): number {
      const a = node.attrs || {};
      if (typeof a[":for"] !== "string") return -1;
      use("bindFor");

      const parsed = parseForExpression(a[":for"]);
      const itemVar = parsed.item;
      const idxVar = parsed.index ?? "__i";
      const listExpr = parsed.list;

      const keyExpr =
        typeof a[":key"] === "string" && a[":key"].trim().length
          ? a[":key"].trim()
          : null;

      const getItems = `() => ((${listExpr}) || [])`;
      const keyOf = `(${itemVar}, ${idxVar}) => (${keyExpr ?? idxVar})`;
      const blockFactory = emitBlockFactory(node.children, [itemVar, idxVar]);

      linesBindings.push(
        `__stops.push(bindFor(${parentVar}, ${getItems}, ${keyOf}, ${blockFactory}));`
      );
      return 0;
    }

    // === :mount (inline) ===  Parent→Child props + Child→Parent events (via onX props)
    function inlineEmitMount(parentVar: string, node: any): number {
      const a = node.attrs || {};
      if (typeof a[":mount"] !== "string") return -1;

      // Gather props:
      // - :props="expr" as base
      // - every :foo="bar" becomes { foo: bar }
      // - every @ev="handler($event)" becomes { onEv: (e)=>{ handler(e) } }
      const baseProps =
        typeof a[":props"] === "string" ? a[":props"].trim() : "{}";

      const literalPairs: string[] = [];

      // attribute props
      for (const k in a) {
        if (k === ":mount" || k === ":props") continue;
        if (k.startsWith(":")) {
          const pname = k.slice(1);
          literalPairs.push(`${JSON.stringify(pname)}: (${a[k]})`);
        }
      }
      // event props
      for (const k in a) {
        if (!k.startsWith("@")) continue;
        const raw = k.slice(1);
        const parts = raw.split(".");
        const ev = parts.shift()!; // ignore behavior/key mods on component events
        const propName = "on" + ev.charAt(0).toUpperCase() + ev.slice(1);
        const body = a[k] || "";
        // support $event passthrough
        const handler = `(e)=>{ ${body.replace(/\$event/g, "e")} }`;
        literalPairs.push(`${JSON.stringify(propName)}: ${handler}`);
      }

      const mergedProps =
        literalPairs.length > 0
          ? `Object.assign({}, (${baseProps}), { ${literalPairs.join(", ")} })`
          : `(${baseProps})`;

      // Emit reactive mount+patch
      // effect is used so props can be reactive; child.patch runs when changed.
      use("effect");
      use("stop");

      const childVar = localId("child");
      const runVar = localId("run");

      linesBindings.push(
        `
{
  let ${childVar} = null;
  const ${runVar} = effect(() => {
    const __p = (${mergedProps});
    if (!${childVar}) {
      const __C = (${a[":mount"]});
      ${childVar} = __C(__p, { app: ctx.app });
      ${childVar}.mount(${parentVar}, null);
    } else {
      ${childVar}.patch && ${childVar}.patch(__p);
    }
  });
  __stops.push(() => { stop(${runVar}); try { ${childVar} && ${childVar}.destroy && ${childVar}.destroy(); } catch {} });
}
`.trim()
      );

      return 0;
    }

    function walkInline(
      n: Node,
      parentVar: string,
      siblings: Node[],
      idx: number,
      ROOT: string
    ): number {
      if (n.type === "el" && n.tag === "template") {
        const a: any = (n as any).attrs || {};
        if (typeof a[":if"] === "string") {
          const { branches, elseChildren, consumedTo } = collectIfClusterInline(
            siblings,
            idx
          );
          inlineEmitSwitchCall(parentVar, branches, elseChildren);
          return consumedTo;
        }
        if (typeof a[":switch"] === "string") {
          const { branches, elseChildren, consumedTo } =
            collectSwitchClusterInline(a[":switch"], siblings, idx);
          inlineEmitSwitchCall(parentVar, branches, elseChildren);
          return consumedTo;
        }
        const f = inlineEmitFor(parentVar, n as any);
        if (f >= 0) return idx;

        const m = inlineEmitMount(parentVar, n as any);
        if (m >= 0) return idx;
      }

      if (n.type === "text") {
        const expr = compileTextExpr(n.value);
        const t = localId("t");
        linesCreate.push(
          `const ${t} = Dom.createText(${
            expr ? "''" : JSON.stringify(n.value)
          });`
        );
        insertLine(t, parentVar, ROOT);
        if (expr) {
          linesBindings.push(`__stops.push(bindText(${t}, () => (${expr})));`);
          use("bindText");
        }
        return idx;
      }

      // element
      const el = localId("e");
      linesCreate.push(
        `const ${el} = Dom.createElement(${JSON.stringify(n.tag)});`
      );
      if (scopeAttr) {
        linesCreate.push(
          `Dom.setAttr(${el}, ${JSON.stringify(scopeAttr)}, "");`
        );
      }

      const attrs = (n as any).attrs || {};
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

      const kids = (n as any).children as Node[];
      for (let i = 0; i < kids.length; i++) {
        i = walkInline(kids[i], el, kids, i, ROOT);
      }

      insertLine(el, parentVar, ROOT);
      return idx;
    }

    const rootContainer = localId("frag");
    const anchor = localId("a");
    const ROOT = rootContainer;

    const mountHeader = [
      `Dom.insert(${anchor}, parent, anchorNode ?? null);`,
      `const ${rootContainer} = parent;`,
      `const __a = anchorNode ?? null;`,
    ];

    const destroyFooter = [
      `for (let i = __stops.length - 1; i >= 0; i--) { try { __stops[i](); } catch {} }`,
      `Dom.remove(${anchor});`,
    ];

    for (let i = 0; i < children.length; i++) {
      i = walkInline(children[i], rootContainer, children, i, ROOT);
    }

    const params = paramNames.length ? `(${paramNames.join(", ")})` : `()`;
    return `${params} => {
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

  function emitEmptyBlockFactory(label = "empty") {
    return `() => ({ el: Dom.createAnchor(${JSON.stringify(
      label
    )}), mount(){}, destroy(){} })`;
  }

  // ---- collectors for top/sibling-level clusters (if/switch only) ----
  function collectIfCluster(
    siblings: Node[],
    startIndex: number
  ): {
    branches: { when: string; children: Node[] }[];
    elseChildren?: Node[];
    consumedTo: number;
  } {
    const first = siblings[startIndex] as any;
    const branches: { when: string; children: Node[] }[] = [];
    let elseChildren: Node[] | undefined;
    branches.push({
      when: `() => ((${first.attrs[":if"]}))`,
      children: first.children,
    });
    let j = startIndex + 1;
    while (j < siblings.length) {
      const sib = siblings[j] as any;
      if (sib.type !== "el" || sib.tag !== "template") break;
      const hasElseIf = typeof sib.attrs[":else-if"] === "string";
      const hasElse = Object.prototype.hasOwnProperty.call(sib.attrs, ":else");
      if (!hasElseIf && !hasElse) break;
      if (hasElseIf) {
        branches.push({
          when: `() => ((${sib.attrs[":else-if"]}))`,
          children: sib.children,
        });
        j++;
        continue;
      }
      if (hasElse) {
        elseChildren = sib.children;
        j++;
        break;
      }
    }
    return { branches, elseChildren, consumedTo: j - 1 };
  }

  function collectSwitchCluster(
    switchExpr: string,
    siblings: Node[],
    startIndex: number
  ): {
    branches: { when: string; children: Node[] }[];
    elseChildren?: Node[];
    consumedTo: number;
  } {
    const branches: { when: string; children: Node[] }[] = [];
    let elseChildren: Node[] | undefined;
    let j = startIndex + 1;
    while (j < siblings.length) {
      const sib = siblings[j] as any;
      if (sib.type !== "el" || sib.tag !== "template") break;
      const hasCase = Object.prototype.hasOwnProperty.call(sib.attrs, ":case");
      const hasDefault = Object.prototype.hasOwnProperty.call(
        sib.attrs,
        ":default"
      );
      if (!hasCase && !hasDefault) break;
      if (hasCase) {
        const c = (sib.attrs[":case"] ?? "").trim();
        branches.push({
          when: `() => (((${switchExpr})) === ((${c})))`,
          children: sib.children,
        });
        j++;
        continue;
      }
      if (hasDefault) {
        elseChildren = sib.children;
        j++;
        break;
      }
    }
    return { branches, elseChildren, consumedTo: j - 1 };
  }

  function emitSwitchCallToMount(
    parentVar: string,
    branches: { when: string; children: Node[] }[],
    elseChildren?: Node[]
  ) {
    use("bindSwitch");
    const arr = `[${branches
      .map(
        (b) =>
          `{ when: (${b.when}), factory: (${emitBlockFactory(b.children)}) }`
      )
      .join(", ")}]`;
    if (elseChildren && elseChildren.length) {
      const ef = emitBlockFactory(elseChildren);
      mount.push(`__stops.push(bindSwitch(${parentVar}, ${arr}, ${ef}));`);
    } else {
      mount.push(`__stops.push(bindSwitch(${parentVar}, ${arr}));`);
    }
  }

  // ---- :for parser ----
  function parseForExpression(src: string): {
    item: string;
    index?: string;
    list: string;
  } {
    const re =
      /^\s*(?:\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)|([A-Za-z_$][\w$]*))\s+in\s+([\s\S]+?)\s*$/;
    const m = re.exec(src);
    if (!m) return { item: "item", index: "__i", list: src.trim() };
    const item = (m[1] || m[3]).trim();
    const index = m[2] ? m[2].trim() : undefined;
    const list = m[4].trim();
    return { item, index, list };
  }

  // ---- main walker (top-level + element children) ----
  function walk(
    n: Node,
    parentVar?: string,
    siblings?: Node[],
    idx?: number
  ): string {
    // handle clusters and :mount at same level
    if (
      n.type === "el" &&
      n.tag === "template" &&
      parentVar &&
      siblings &&
      typeof idx === "number"
    ) {
      const a: any = n.attrs || {};
      if (typeof a[":if"] === "string") {
        const { branches, elseChildren, consumedTo } = collectIfCluster(
          siblings,
          idx
        );
        emitSwitchCallToMount(parentVar, branches, elseChildren);
        return parentVar;
      }
      if (typeof a[":switch"] === "string") {
        const { branches, elseChildren } = collectSwitchCluster(
          a[":switch"],
          siblings,
          idx
        );
        emitSwitchCallToMount(parentVar, branches, elseChildren);
        return parentVar;
      }
      if (typeof a[":for"] === "string") {
        use("bindFor");
        const parsed = parseForExpression(a[":for"]);
        const itemVar = parsed.item;
        const idxVar = parsed.index ?? "__i";
        const listExpr = parsed.list;
        const keyExpr =
          typeof a[":key"] === "string" && a[":key"].trim().length
            ? a[":key"].trim()
            : null;
        const getItems = `() => ((${listExpr}) || [])`;
        const keyOf = `(${itemVar}, ${idxVar}) => (${keyExpr ?? idxVar})`;
        const blockFactory = emitBlockFactory(n.children, [itemVar, idxVar]);
        mount.push(
          `__stops.push(bindFor(${parentVar}, ${getItems}, ${keyOf}, ${blockFactory}));`
        );
        return parentVar;
      }
      // === :mount (top/sibling level) ===
      if (typeof a[":mount"] === "string") {
        // reuse inline logic by creating a faux block and appending to mount[]
        const fakeParent = parentVar;
        // build exactly as inlineEmitMount would do:
        const baseProps =
          typeof a[":props"] === "string" ? a[":props"].trim() : "{}";
        const literalPairs: string[] = [];
        for (const k in a) {
          if (k === ":mount" || k === ":props") continue;
          if (k.startsWith(":")) {
            const pname = k.slice(1);
            literalPairs.push(`${JSON.stringify(pname)}: (${a[k]})`);
          }
        }
        for (const k in a) {
          if (!k.startsWith("@")) continue;
          const raw = k.slice(1);
          const parts = raw.split(".");
          const ev = parts.shift()!;
          const propName = "on" + ev.charAt(0).toUpperCase() + ev.slice(1);
          const body = a[k] || "";
          const handler = `(e)=>{ ${body.replace(/\$event/g, "e")} }`;
          literalPairs.push(`${JSON.stringify(propName)}: ${handler}`);
        }
        const mergedProps =
          literalPairs.length > 0
            ? `Object.assign({}, (${baseProps}), { ${literalPairs.join(
                ", "
              )} })`
            : `(${baseProps})`;
        use("effect");
        use("stop");
        const childVar = vid("child");
        const runVar = vid("run");
        mount.push(
          `
{
  let ${childVar} = null;
  const ${runVar} = effect(() => {
    const __p = (${mergedProps});
    if (!${childVar}) {
      const __C = (${a[":mount"]});
      ${childVar} = __C(__p, { app: ctx.app });
      ${childVar}.mount(${fakeParent}, null);
    } else {
      ${childVar}.patch && ${childVar}.patch(__p);
    }
  });
  __stops.push(() => { stop(${runVar}); try { ${childVar} && ${childVar}.destroy && ${childVar}.destroy(); } catch {} });
}
`.trim()
        );
        return parentVar;
      }
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

    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i];

      if (c.type === "el" && c.tag === "template") {
        const a: any = c.attrs || {};
        if (typeof a[":if"] === "string") {
          const { branches, elseChildren, consumedTo } = collectIfCluster(
            n.children,
            i
          );
          emitSwitchCallToMount(el, branches, elseChildren);
          i = consumedTo;
          continue;
        }
        if (typeof a[":switch"] === "string") {
          const { branches, elseChildren, consumedTo } = collectSwitchCluster(
            a[":switch"],
            n.children,
            i
          );
          emitSwitchCallToMount(el, branches, elseChildren);
          i = consumedTo;
          continue;
        }
        if (typeof a[":for"] === "string") {
          use("bindFor");
          const parsed = parseForExpression(a[":for"]);
          const itemVar = parsed.item;
          const idxVar = parsed.index ?? "__i";
          const listExpr = parsed.list;
          const keyExpr =
            typeof a[":key"] === "string" && a[":key"].trim().length
              ? a[":key"].trim()
              : null;
          const getItems = `() => ((${listExpr}) || [])`;
          const keyOf = `(${itemVar}, ${idxVar}) => (${keyExpr ?? idxVar})`;
          const blockFactory = emitBlockFactory(c.children, [itemVar, idxVar]);
          mount.push(
            `__stops.push(bindFor(${el}, ${getItems}, ${keyOf}, ${blockFactory}));`
          );
          continue;
        }
        // === :mount in children ===
        if (typeof a[":mount"] === "string") {
          const baseProps =
            typeof a[":props"] === "string" ? a[":props"].trim() : "{}";
          const literalPairs: string[] = [];
          for (const k in a) {
            if (k === ":mount" || k === ":props") continue;
            if (k.startsWith(":")) {
              const pname = k.slice(1);
              literalPairs.push(`${JSON.stringify(pname)}: (${a[k]})`);
            }
          }
          for (const k in a) {
            if (!k.startsWith("@")) continue;
            const raw = k.slice(1);
            const parts = raw.split(".");
            const ev = parts.shift()!;
            const propName = "on" + ev.charAt(0).toUpperCase() + ev.slice(1);
            const body = a[k] || "";
            const handler = `(e)=>{ ${body.replace(/\$event/g, "e")} }`;
            literalPairs.push(`${JSON.stringify(propName)}: ${handler}`);
          }
          const mergedProps =
            literalPairs.length > 0
              ? `Object.assign({}, (${baseProps}), { ${literalPairs.join(
                  ", "
                )} })`
              : `(${baseProps})`;
          use("effect");
          use("stop");
          const childVar = vid("child");
          const runVar = vid("run");
          mount.push(
            `
{
  let ${childVar} = null;
  const ${runVar} = effect(() => {
    const __p = (${mergedProps});
    if (!${childVar}) {
      const __C = (${a[":mount"]});
      ${childVar} = __C(__p, { app: ctx.app });
      ${childVar}.mount(${el}, null);
    } else {
      ${childVar}.patch && ${childVar}.patch(__p);
    }
  });
  __stops.push(() => { stop(${runVar}); try { ${childVar} && ${childVar}.destroy && ${childVar}.destroy(); } catch {} });
}
`.trim()
          );
          continue;
        }
      }

      const res = walk(c, el, n.children, i);
      if (c.type === "el") {
        mount.push(`Dom.insert(${res}, ${el});`);
      }
    }

    if (parentVar) mount.push(`Dom.insert(${el}, ${parentVar});`);
    return el;
  }

  const roots: string[] = [];
  for (let i = 0; i < ast.length; i++) {
    const n = ast[i];

    if (n.type === "el" && n.tag === "template") {
      const a: any = n.attrs || {};
      if (typeof a[":if"] === "string") {
        const { branches, elseChildren, consumedTo } = collectIfCluster(ast, i);
        emitSwitchCallToMount("target" as any, branches, elseChildren);
        i = consumedTo;
        continue;
      }
      if (typeof a[":switch"] === "string") {
        const { branches, elseChildren, consumedTo } = collectSwitchCluster(
          a[":switch"],
          ast,
          i
        );
        emitSwitchCallToMount("target" as any, branches, elseChildren);
        i = consumedTo;
        continue;
      }
      if (typeof a[":for"] === "string") {
        use("bindFor");
        const parsed = parseForExpression(a[":for"]);
        const itemVar = parsed.item;
        const idxVar = parsed.index ?? "__i";
        const listExpr = parsed.list;
        const keyExpr =
          typeof a[":key"] === "string" && a[":key"].trim().length
            ? a[":key"].trim()
            : null;
        const getItems = `() => ((${listExpr}) || [])`;
        const keyOf = `(${itemVar}, ${idxVar}) => (${keyExpr ?? idxVar})`;
        const blockFactory = emitBlockFactory(n.children, [itemVar, idxVar]);
        mount.push(
          `__stops.push(bindFor(target, ${getItems}, ${keyOf}, ${blockFactory}));`
        );
        continue;
      }
      // === :mount at top level ===
      if (typeof a[":mount"] === "string") {
        const baseProps =
          typeof a[":props"] === "string" ? a[":props"].trim() : "{}";
        const literalPairs: string[] = [];
        for (const k in a) {
          if (k === ":mount" || k === ":props") continue;
          if (k.startsWith(":")) {
            const pname = k.slice(1);
            literalPairs.push(`${JSON.stringify(pname)}: (${a[k]})`);
          }
        }
        for (const k in a) {
          if (!k.startsWith("@")) continue;
          const raw = k.slice(1);
          const parts = raw.split(".");
          const ev = parts.shift()!;
          const propName = "on" + ev.charAt(0).toUpperCase() + ev.slice(1);
          const body = a[k] || "";
          const handler = `(e)=>{ ${body.replace(/\$event/g, "e")} }`;
          literalPairs.push(`${JSON.stringify(propName)}: ${handler}`);
        }
        const mergedProps =
          literalPairs.length > 0
            ? `Object.assign({}, (${baseProps}), { ${literalPairs.join(
                ", "
              )} })`
            : `(${baseProps})`;
        use("effect");
        use("stop");
        const childVar = vid("child");
        const runVar = vid("run");
        mount.push(
          `
{
  let ${childVar} = null;
  const ${runVar} = effect(() => {
    const __p = (${mergedProps});
    if (!${childVar}) {
      const __C = (${a[":mount"]});
      ${childVar} = __C(__p, { app: ctx.app });
      ${childVar}.mount(target, anchor ?? null);
    } else {
      ${childVar}.patch && ${childVar}.patch(__p);
    }
  });
  __stops.push(() => { stop(${runVar}); try { ${childVar} && ${childVar}.destroy && ${childVar}.destroy(); } catch {} });
}
`.trim()
        );
        continue;
      }
    }

    const res = walk(n, undefined, ast, i);
    if (n.type === "el") {
      if (
        !(
          n.tag === "template" &&
          (":if" in n.attrs ||
            ":switch" in n.attrs ||
            ":for" in n.attrs ||
            ":mount" in n.attrs)
        )
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
