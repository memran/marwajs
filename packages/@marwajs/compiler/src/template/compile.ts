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
const KEY_MAP: Record<string, string[]> = {
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

// ---------- small utils ----------
const has = (o: any, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const q = JSON.stringify;
const trimOr = (s: any, fallback = "") =>
  typeof s === "string" ? s.trim() : fallback;

function splitMods(raw: string) {
  const parts = raw.split(".");
  const type = parts.shift()!;
  const behavior = parts.filter((m) => BEHAVIOR_MODS.has(m));
  const keymods = parts.filter((m) => has(KEY_MAP, m));
  return { type, behavior, keymods };
}

function buildEventHandler(
  code: string,
  behavior: string[],
  keymods: string[]
) {
  let handler = `(e)=>{ ${code} }`;
  if (keymods.length) {
    const keys = keymods.map((k) => KEY_MAP[k]).flat();
    handler = `(e)=>{ if (!(${JSON.stringify(
      keys
    )}).includes(e.key)) return; ${code} }`;
  }
  if (behavior.length) {
    handler = `withModifiers(${handler}, [${behavior
      .map((m) => q(m))
      .join(",")}])`;
  }
  return handler;
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

// ---------- interpolation ----------
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

// ---------- common collectors (if / switch) ----------
type Branch = { when: string; children: Node[] };
function collectIfCluster(
  siblings: Node[],
  startIndex: number
): { branches: Branch[]; elseChildren?: Node[]; consumedTo: number } {
  const first = siblings[startIndex] as any;
  const branches: Branch[] = [
    { when: `() => ((${first.attrs[":if"]}))`, children: first.children },
  ];
  let elseChildren: Node[] | undefined;
  let j = startIndex + 1;
  while (j < siblings.length) {
    const sib: any = siblings[j];
    if (sib.type !== "el" || sib.tag !== "template") break;
    const hasElseIf = typeof sib.attrs[":else-if"] === "string";
    const hasElse = has(sib.attrs, ":else");
    if (!hasElseIf && !hasElse) break;
    if (hasElseIf) {
      branches.push({
        when: `() => ((${sib.attrs[":else-if"]}))`,
        children: sib.children,
      });
      j++;
      continue;
    }
    elseChildren = sib.children;
    j++;
    break;
  }
  return { branches, elseChildren, consumedTo: j - 1 };
}

function collectSwitchCluster(
  switchExpr: string,
  siblings: Node[],
  startIndex: number
): { branches: Branch[]; elseChildren?: Node[]; consumedTo: number } {
  const branches: Branch[] = [];
  let elseChildren: Node[] | undefined;
  let j = startIndex + 1;
  while (j < siblings.length) {
    const sib: any = siblings[j];
    if (sib.type !== "el" || sib.tag !== "template") break;
    const hasCase = has(sib.attrs, ":case");
    const hasDefault = has(sib.attrs, ":default");
    if (!hasCase && !hasDefault) break;
    if (hasCase) {
      const c = trimOr(sib.attrs[":case"]);
      branches.push({
        when: `() => (((${switchExpr})) === ((${c})))`,
        children: sib.children,
      });
      j++;
      continue;
    }
    elseChildren = sib.children;
    j++;
    break;
  }
  return { branches, elseChildren, consumedTo: j - 1 };
}

// ---------- shared emit helpers ----------

function emitForBinding(
  push: (line: string) => void,
  use: (n: string) => void,
  parentVar: string,
  forSrc: string,
  keySrc: string | undefined,
  factory: string
) {
  use("bindFor");
  const parsed = parseForExpression(forSrc);
  const itemVar = parsed.item;
  const idxVar = parsed.index ?? "__i";
  const listExpr = parsed.list;
  const keyExpr =
    typeof keySrc === "string" && keySrc.trim().length ? keySrc.trim() : null;
  const getItems = `() => ((${listExpr}) || [])`;
  const keyOf = `(${itemVar}, ${idxVar}) => (${keyExpr ?? idxVar})`;
  push(
    `__stops.push(bindFor(${parentVar}, ${getItems}, ${keyOf}, ${factory}));`
  );
}

function buildMountPropsObject(attrs: Record<string, string>): string {
  const baseProps = trimOr(attrs[":props"], "{}");
  const pairs: string[] = [];

  // attribute props
  for (const k in attrs) {
    if (k === ":mount" || k === ":props") continue;
    if (k.startsWith(":")) {
      const pname = k.slice(1);
      pairs.push(`${q(pname)}: (${attrs[k]})`);
    }
  }
  // event props → onX
  for (const k in attrs) {
    if (!k.startsWith("@")) continue;
    const { type } = splitMods(k.slice(1)); // ignore modifiers for component props
    const propName = "on" + type.charAt(0).toUpperCase() + type.slice(1);
    const body = attrs[k] || "";
    const handler = `(e)=>{ ${body.replace(/\$event/g, "e")} }`;
    pairs.push(`${q(propName)}: ${handler}`);
  }

  return pairs.length > 0
    ? `Object.assign({}, (${baseProps}), { ${pairs.join(", ")} })`
    : `(${baseProps})`;
}

// ---------- compiler ----------
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
  use("Dom"); // always used

  let id = 0;
  const vid = (p: string) => `_${p}${++id}`;

  // ---------- unified block factory (optionally parameterized) ----------
  function emitBlockFactory(
    children: Node[],
    paramNames: string[] = []
  ): string {
    use("Dom");

    let local = 0;
    const lid = (p: string) => `__b_${p}${++local}`;
    const linesCreate: string[] = [];
    const linesMount: string[] = [];
    const linesBind: string[] = [];

    // compile-time locals (variable names for runtime code)
    const rootContainer = lid("root");
    const anchor = lid("a");
    const ROOT = rootContainer;

    const insert = (childVar: string, parentVar: string) => {
      if (parentVar === ROOT) {
        linesMount.push(`Dom.insert(${childVar}, ${parentVar}, __a);`);
      } else {
        linesMount.push(`Dom.insert(${childVar}, ${parentVar});`);
      }
    };

    // inline cluster emitters use the same helpers as top-level
    const inlineFor = (parentVar: string, node: any): number => {
      const a = node.attrs || {};
      if (typeof a[":for"] !== "string") return -1;
      const parsed = parseForExpression(a[":for"]);
      const factory = emitBlockFactory(node.children, [
        parsed.item,
        parsed.index ?? "__i",
      ]);
      emitForBinding(
        (l) => linesBind.push(l),
        use,
        parentVar,
        a[":for"],
        a[":key"],
        factory
      );
      return 0;
    };

    const inlineMount = (parentVar: string, node: any): number => {
      const a = node.attrs || {};
      if (typeof a[":mount"] !== "string") return -1;
      use("effect");
      use("stop");
      const childVar = lid("child");
      const runVar = lid("run");
      const mergedProps = buildMountPropsObject(a);
      linesBind.push(
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
    };

    function walkInline(
      n: Node,
      parentVar: string,
      siblings: Node[],
      idx: number
    ): number {
      if (n.type === "el" && n.tag === "template") {
        const a: any = n.attrs || {};
        if (typeof a[":if"] === "string") {
          const { branches, elseChildren, consumedTo } = collectIfCluster(
            siblings,
            idx
          );
          emitSwitchBinding(
            (l) => linesBind.push(l),
            use,
            parentVar,
            branches,
            elseChildren
          );
          return consumedTo;
        }
        if (typeof a[":switch"] === "string") {
          const { branches, elseChildren, consumedTo } = collectSwitchCluster(
            a[":switch"],
            siblings,
            idx
          );
          emitSwitchBinding(
            (l) => linesBind.push(l),
            use,
            parentVar,
            branches,
            elseChildren
          );
          return consumedTo;
        }
        const f = inlineFor(parentVar, n as any);
        if (f >= 0) return idx;
        const m = inlineMount(parentVar, n as any);
        if (m >= 0) return idx;
      }

      if (n.type === "text") {
        const expr = compileTextExpr(n.value);
        const t = lid("t");
        linesCreate.push(
          `const ${t} = Dom.createText(${
            expr ? "''" : JSON.stringify(n.value)
          });`
        );
        insert(t, parentVar);
        if (expr) {
          linesBind.push(`__stops.push(bindText(${t}, () => (${expr})));`);
          use("bindText");
        }
        return idx;
      }

      // element
      const el = lid("e");
      linesCreate.push(
        `const ${el} = Dom.createElement(${JSON.stringify(n.tag)});`
      );
      if (scopeAttr)
        linesCreate.push(
          `Dom.setAttr(${el}, ${JSON.stringify(scopeAttr)}, "");`
        );

      const attrs = (n as any).attrs || {};
      for (const k in attrs) {
        const v = attrs[k];

        if (k === ":text") {
          const tn = lid("t");
          linesCreate.push(`const ${tn} = Dom.createText('');`);
          linesMount.push(`Dom.insert(${tn}, ${el});`);
          linesBind.push(`__stops.push(bindText(${tn}, () => (${v})));`);
          use("bindText");
          continue;
        }
        if (k === ":class") {
          linesBind.push(`__stops.push(bindClass(${el}, () => (${v})));`);
          use("bindClass");
          continue;
        }
        if (k === ":style") {
          linesBind.push(`__stops.push(bindStyle(${el}, () => (${v})));`);
          use("bindStyle");
          continue;
        }
        if (k === ":show") {
          linesBind.push(`__stops.push(bindShow(${el}, () => !!(${v})));`);
          use("bindShow");
          continue;
        }

        if (k.startsWith("m-model")) {
          const [, ...mods] = k.split(".");
          const opts: any = {
            ...(mods.includes("number") ? { number: true } : {}),
            ...(mods.includes("trim") ? { trim: true } : {}),
            ...(mods.includes("lazy") ? { lazy: true } : {}),
          };
          const model = v.trim();
          const isRef = /\.value$/.test(model);
          const getExpr = isRef ? model : `${model}()`;
          const setExpr = isRef ? `${model} = $_` : `${model}.set($_)`;
          linesBind.push(
            `__stops.push(bindModel(ctx.app, ${el}, () => (${getExpr}), (v) => (${setExpr.replace(
              /\$_/g,
              "v"
            )}), ${JSON.stringify(opts)}));`
          );
          use("bindModel");
          continue;
        }

        if (k.startsWith("@")) {
          const { type, behavior, keymods } = splitMods(k.slice(1));
          let handler = buildEventHandler(v, behavior, keymods);
          if (behavior.length) use("withModifiers");
          linesBind.push(
            `__stops.push(onEvent(ctx.app, ${el}, ${JSON.stringify(
              type
            )}, ${handler}));`
          );
          use("onEvent");
          continue;
        }

        if (k.startsWith(":")) {
          const name = k.slice(1);
          linesBind.push(
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
      for (let i = 0; i < kids.length; i++)
        i = walkInline(kids[i], el, kids, i);

      insert(el, parentVar);
      return idx;
    }

    // compile-time walk of children to fill lines*
    for (let i = 0; i < children.length; i++) {
      i = walkInline(children[i], ROOT, children, i);
    }

    const params = paramNames.length ? `(${paramNames.join(", ")})` : `()`;
    return `${params} => {
  const __stops = [];
  const ${anchor} = Dom.createAnchor('block');
  return {
    el: ${anchor},
    mount(parent, anchorNode) {
      Dom.insert(${anchor}, parent, anchorNode ?? null);
      const ${rootContainer} = parent;
      const __a = anchorNode ?? null;
      ${linesCreate.join("\n      ")}
      ${linesMount.join("\n      ")}
      ${linesBind.join("\n      ")}
    },
    destroy() {
      for (let i = __stops.length - 1; i >= 0; i--) { try { __stops[i](); } catch {} }
      Dom.remove(${anchor});
    }
  };
}`;
  }

  // ---------- now that emitBlockFactory exists, we can define emitSwitchBinding ----------
  function emitSwitchBinding(
    push: (line: string) => void,
    use: (n: string) => void,
    parentVar: string,
    branches: { when: string; children: Node[] }[],
    elseChildren?: Node[]
  ) {
    use("bindSwitch");
    const rec = (b: { when: string; children: Node[] }) =>
      `{ when: (${b.when}), factory: (${emitBlockFactory(b.children)}) }`;
    const arr = `[${branches.map(rec).join(", ")}]`;
    if (elseChildren && elseChildren.length) {
      const ef = emitBlockFactory(elseChildren);
      push(`__stops.push(bindSwitch(${parentVar}, ${arr}, ${ef}));`);
    } else {
      push(`__stops.push(bindSwitch(${parentVar}, ${arr}));`);
    }
  }

  // ---------- main walker ----------
  function walk(
    n: Node,
    parentVar?: string,
    siblings?: Node[],
    idx?: number
  ): string {
    // clusters and :mount at same level
    if (
      n.type === "el" &&
      n.tag === "template" &&
      parentVar &&
      siblings &&
      typeof idx === "number"
    ) {
      const a: any = n.attrs || {};

      if (typeof a[":if"] === "string") {
        const { branches, elseChildren } = collectIfCluster(siblings, idx);
        emitSwitchBinding(
          (l) => mount.push(l),
          use,
          parentVar,
          branches,
          elseChildren
        );
        return parentVar;
      }

      if (typeof a[":switch"] === "string") {
        const { branches, elseChildren } = collectSwitchCluster(
          a[":switch"],
          siblings,
          idx
        );
        emitSwitchBinding(
          (l) => mount.push(l),
          use,
          parentVar,
          branches,
          elseChildren
        );
        return parentVar;
      }

      if (typeof a[":for"] === "string") {
        const parsed = parseForExpression(a[":for"]);
        const factory = emitBlockFactory(n.children, [
          parsed.item,
          parsed.index ?? "__i",
        ]);
        emitForBinding(
          (l) => mount.push(l),
          use,
          parentVar,
          a[":for"],
          a[":key"],
          factory
        );
        return parentVar;
      }

      if (typeof a[":mount"] === "string") {
        use("effect");
        use("stop");
        const mergedProps = buildMountPropsObject(a);
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
      ${childVar}.mount(${parentVar}, null);
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
        const opts: any = {
          ...(mods.includes("number") ? { number: true } : {}),
          ...(mods.includes("trim") ? { trim: true } : {}),
          ...(mods.includes("lazy") ? { lazy: true } : {}),
        };
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
        const { type, behavior, keymods } = splitMods(k.slice(1));
        const handler = buildEventHandler(v, behavior, keymods);
        if (behavior.length) use("withModifiers");
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

    // handle children including nested clusters & :mount
    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i];

      if (c.type === "el" && c.tag === "template") {
        const a: any = c.attrs || {};
        if (typeof a[":if"] === "string") {
          const { branches, elseChildren, consumedTo } = collectIfCluster(
            n.children,
            i
          );
          emitSwitchBinding(
            (l) => mount.push(l),
            use,
            el,
            branches,
            elseChildren
          );
          i = consumedTo;
          continue;
        }
        if (typeof a[":switch"] === "string") {
          const { branches, elseChildren, consumedTo } = collectSwitchCluster(
            a[":switch"],
            n.children,
            i
          );
          emitSwitchBinding(
            (l) => mount.push(l),
            use,
            el,
            branches,
            elseChildren
          );
          i = consumedTo;
          continue;
        }
        if (typeof a[":for"] === "string") {
          const parsed = parseForExpression(a[":for"]);
          const factory = emitBlockFactory(c.children, [
            parsed.item,
            parsed.index ?? "__i",
          ]);
          emitForBinding(
            (l) => mount.push(l),
            use,
            el,
            a[":for"],
            a[":key"],
            factory
          );
          continue;
        }
        // === :mount in children ===
        if (typeof a[":mount"] === "string") {
          use("effect");
          use("stop");
          const mergedProps = buildMountPropsObject(a);
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
      if (c.type === "el") mount.push(`Dom.insert(${res}, ${el});`);
    }

    if (parentVar) mount.push(`Dom.insert(${el}, ${parentVar});`);
    return el;
  }

  // ---------- roots ----------
  const roots: string[] = [];
  for (let i = 0; i < ast.length; i++) {
    const n = ast[i];

    if (n.type === "el" && n.tag === "template") {
      const a: any = n.attrs || {};

      if (typeof a[":if"] === "string") {
        const { branches, elseChildren, consumedTo } = collectIfCluster(ast, i);
        emitSwitchBinding(
          (l) => mount.push(l),
          use,
          "target" as any,
          branches,
          elseChildren
        );
        i = consumedTo;
        continue;
      }
      if (typeof a[":switch"] === "string") {
        const { branches, elseChildren, consumedTo } = collectSwitchCluster(
          a[":switch"],
          ast,
          i
        );
        emitSwitchBinding(
          (l) => mount.push(l),
          use,
          "target" as any,
          branches,
          elseChildren
        );
        i = consumedTo;
        continue;
      }
      if (typeof a[":for"] === "string") {
        const parsed = parseForExpression(a[":for"]);
        const factory = emitBlockFactory(n.children, [
          parsed.item,
          parsed.index ?? "__i",
        ]);
        emitForBinding(
          (l) => mount.push(l),
          use,
          "target" as any,
          a[":for"],
          a[":key"],
          factory
        );
        continue;
      }
      // === :mount at top level ===
      if (typeof a[":mount"] === "string") {
        use("effect");
        use("stop");
        const mergedProps = buildMountPropsObject(a);
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
    if (
      n.type === "el" &&
      !(
        n.tag === "template" &&
        (has(n.attrs, ":if") ||
          has(n.attrs, ":switch") ||
          has(n.attrs, ":for") ||
          has(n.attrs, ":mount"))
      )
    ) {
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
    const parent = stack[0] && (stack[stack.length - 1] as any);
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
