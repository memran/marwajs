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
  const body = code.replace(/\$event/g, "e");
  let handler = `(e)=>{ ${body} }`;

  if (keymods.length) {
    const keys = keymods.map((k) => KEY_MAP[k]).flat();
    handler = `(e)=>{ if (!(${JSON.stringify(
      keys
    )}).includes(e.key)) return; ${body} }`;
  }
  if (behavior.length) {
    handler = `withModifiers(${handler}, [${behavior
      .map((m) => q(m))
      .join(",")}])`;
  }
  return handler;
}

// ---------- attribute normalization & node helpers ----------
const UPPER_TAG_RE = /^[A-Z]/;
const isComponentTag = (tag: string) => UPPER_TAG_RE.test(tag);

function normalizeAttrKey(k: string): { key: string; isEvent: boolean } {
  if (k.startsWith(":")) return { key: "m-" + k.slice(1), isEvent: false };
  // "m-on:" is 5 chars -> slice(5) gives after the colon
  if (k.startsWith("m-on:")) return { key: "@" + k.slice(5), isEvent: true };
  if (k.startsWith("m-")) return { key: k, isEvent: false };
  if (k.startsWith("@")) return { key: k, isEvent: true };
  return { key: k, isEvent: false };
}
function normalizeAttrs(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k in attrs) {
    const { key } = normalizeAttrKey(k);
    out[key] = attrs[k];
  }
  return out;
}

// keys that should not turn into generic m-* props/attrs
const CLUSTER_KEYS = new Set([
  "m-if",
  "m-else-if",
  "m-else",
  "m-switch",
  "m-case",
  "m-default",
  "m-for",
  "m-key",
  "m-mount",
  "m-props",
]);

function cloneNodeShallow(n: Node): Node {
  if (n.type === "text") return { type: "text", value: n.value };
  const attrs: Record<string, string> = {};
  const src: any = n;
  for (const k in src.attrs) {
    if (!CLUSTER_KEYS.has(k)) attrs[k] = src.attrs[k];
  }
  return { type: "el", tag: src.tag, attrs, children: src.children };
}

// Use the node itself as branch content when cluster is on a non-template elt
function asChildren(n: Node): Node[] {
  if (n.type === "el" && n.tag === "template") return n.children;
  return [cloneNodeShallow(n)];
}

// Convenience guards (cluster can be on any element)
const hasIf = (a: any) => typeof a["m-if"] === "string";
const hasElseIf = (a: any) =>
  Object.prototype.hasOwnProperty.call(a, "m-else-if");
const hasElse = (a: any) => Object.prototype.hasOwnProperty.call(a, "m-else");
const hasSwitch = (a: any) => typeof a["m-switch"] === "string";
const hasCase = (a: any) => Object.prototype.hasOwnProperty.call(a, "m-case");
const hasDefault = (a: any) =>
  Object.prototype.hasOwnProperty.call(a, "m-default");
const hasFor = (a: any) => typeof a["m-for"] === "string";
const hasKey = (a: any) => typeof a["m-key"] === "string";
const hasMount = (a: any) => typeof a["m-mount"] === "string";

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
  first.attrs = normalizeAttrs(first.attrs || {});
  const branches: Branch[] = [
    { when: `() => ((${first.attrs["m-if"]}))`, children: asChildren(first) },
  ];
  let elseChildren: Node[] | undefined;
  let j = startIndex + 1;

  while (j < siblings.length) {
    const sib: any = siblings[j];
    if (sib.type !== "el") break;
    sib.attrs = normalizeAttrs(sib.attrs || {});
    if (!(hasElseIf(sib.attrs) || hasElse(sib.attrs))) break;

    if (hasElseIf(sib.attrs)) {
      branches.push({
        when: `() => ((${sib.attrs["m-else-if"]}))`,
        children: asChildren(sib),
      });
      j++;
      continue;
    }
    elseChildren = asChildren(sib);
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
    if (sib.type !== "el") break;
    sib.attrs = normalizeAttrs(sib.attrs || {});
    if (!(hasCase(sib.attrs) || hasDefault(sib.attrs))) break;

    if (hasCase(sib.attrs)) {
      const c = (sib.attrs["m-case"] ?? "").trim();
      branches.push({
        when: `() => (((${switchExpr})) === ((${c})))`,
        children: asChildren(sib),
      });
      j++;
      continue;
    }
    elseChildren = asChildren(sib);
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
  const baseProps = trimOr(attrs["m-props"], "{}");
  const pairs: string[] = [];

  // m-* props (skip clusters and known reactive keys)
  for (const k in attrs) {
    if (CLUSTER_KEYS.has(k)) continue;
    if (k.startsWith("m-")) {
      const pname = k.slice(2);
      if (
        pname === "text" ||
        pname === "class" ||
        pname === "style" ||
        pname === "show" ||
        pname.startsWith("model") ||
        pname === "props" ||
        pname === "mount" ||
        pname === "if" ||
        pname === "else-if" ||
        pname === "else" ||
        pname === "switch" ||
        pname === "case" ||
        pname === "default" ||
        pname === "for" ||
        pname === "key"
      )
        continue;
      pairs.push(`${JSON.stringify(pname)}: (${attrs[k]})`);
    }
  }

  // @event → onEvent: (e)=>{ ... }
  for (const k in attrs) {
    if (!k.startsWith("@")) continue;
    const raw = k.slice(1); // e.g. "close" or "save.stop"
    const parts = raw.split(".");
    const ev = parts.shift()!; // "close"
    const propName = "on" + ev[0].toUpperCase() + ev.slice(1); // "onClose"
    const body = attrs[k] || "";
    const handler = `(e)=>{ ${body.replace(/\$event/g, "e")} }`;
    pairs.push(`${JSON.stringify(propName)}: ${handler}`);
  }

  return pairs.length > 0
    ? `Object.assign({}, (${baseProps}), { ${pairs.join(", ")} })`
    : `(${baseProps})`;
}

// ---------- VALIDATION (parser-time warnings) ----------
type Warning = {
  code: string;
  message: string;
  path: number[]; // index path in the tree, e.g., [0,2,1]
  tag?: string;
};

function collectWarnings(ast: Node[]): Warning[] {
  const warnings: Warning[] = [];

  const pushWarn = (w: Warning) => warnings.push(w);

  // Primary control on a single node
  function primaryControls(n: { tag: string; attrs: Record<string, string> }) {
    const a = n.attrs;
    const list: string[] = [];
    if (hasIf(a)) list.push("m-if");
    if (hasSwitch(a)) list.push("m-switch");
    if (hasFor(a)) list.push("m-for");
    if (hasMount(a)) list.push("m-mount");
    if (isComponentTag(n.tag)) list.push("<Component>");
    return list;
  }

  function validateNode(n: Node, path: number[]) {
    if (n.type !== "el") return;

    // Normalize once for validations
    const a = ((n as any).attrs = normalizeAttrs((n as any).attrs || {}));
    const prim = primaryControls(n as any);

    // 1) Multiple primary controls on the same node
    if (prim.length > 1) {
      pushWarn({
        code: "MULTIPLE_PRIMARY",
        message: `conflict: multiple control directives on the same node: ${prim.join(
          ", "
        )}`,
        path,
        tag: (n as any).tag,
      });
    }

    // 2) m-key without m-for
    if (hasKey(a) && !hasFor(a)) {
      pushWarn({
        code: "KEY_WITHOUT_FOR",
        message: "`m-key` is only valid together with `m-for`.",
        path,
        tag: (n as any).tag,
      });
    }

    // 3) combine <Component/> with m-mount (redundant)
    if (isComponentTag((n as any).tag) && hasMount(a)) {
      pushWarn({
        code: "COMPONENT_AND_MOUNT",
        message:
          "Using both `<Component/>` and `m-mount` is redundant; use only one.",
        path,
        tag: (n as any).tag,
      });
    }
  }

  // Validate sibling relationships for branch directives
  function validateSiblings(siblings: Node[], basePath: number[]) {
    for (let i = 0; i < siblings.length; i++) {
      const n = siblings[i];
      if (n.type !== "el") continue;
      const a = ((n as any).attrs = normalizeAttrs((n as any).attrs || {}));

      // else-if / else must immediately follow an if-chain head or previous else-if
      if (hasElseIf(a) || hasElse(a)) {
        const prev = siblings[i - 1] as any;
        const ok =
          prev &&
          prev.type === "el" &&
          (hasIf(normalizeAttrs(prev.attrs || {})) ||
            hasElseIf(normalizeAttrs(prev.attrs || {})));
        if (!ok) {
          pushWarn({
            code: "MISPLACED_ELSE",
            message:
              "`m-else-if`/`m-else` must immediately follow an element with `m-if` or `m-else-if`.",
            path: basePath.concat(i),
            tag: (n as any).tag,
          });
        }
        // branches shouldn't carry their own primary controls
        const prim = primaryControls(n as any).filter((p) => p !== "m-if");
        if (prim.length) {
          pushWarn({
            code: "BRANCH_WITH_PRIMARY",
            message: `Branch element should not also declare primary controls: ${prim.join(
              ", "
            )}`,
            path: basePath.concat(i),
            tag: (n as any).tag,
          });
        }
      }

      // case / default must immediately follow a switch head or previous case
      if (hasCase(a) || hasDefault(a)) {
        const prev = siblings[i - 1] as any;
        const prevAttrs =
          prev && prev.type === "el" ? normalizeAttrs(prev.attrs || {}) : {};
        const ok =
          prev &&
          prev.type === "el" &&
          (hasSwitch(prevAttrs) || hasCase(prevAttrs));
        if (!ok) {
          pushWarn({
            code: "MISPLACED_CASE",
            message:
              "`m-case`/`m-default` must immediately follow an element with `m-switch` or a previous `m-case`.",
            path: basePath.concat(i),
            tag: (n as any).tag,
          });
        }
        const prim = primaryControls(n as any).filter((p) => p !== "m-switch");
        if (prim.length) {
          pushWarn({
            code: "CASE_WITH_PRIMARY",
            message: `Switch branch should not also declare primary controls: ${prim.join(
              ", "
            )}`,
            path: basePath.concat(i),
            tag: (n as any).tag,
          });
        }
      }

      // Recurse into children
      validateNode(n, basePath.concat(i));
      validateSiblings((n as any).children || [], basePath.concat(i));
    }
  }

  // root-level
  validateSiblings(ast, []);
  return warnings;
}

// ---------- compiler ----------
export function compileTemplateToIR(
  html: string,
  { file, name, scopeAttr }: { file: string; name: string; scopeAttr?: string }
): ComponentIR {
  const ast = parseHTML(html);

  // PARSER-TIME VALIDATION (non-fatal)
  const warnings = collectWarnings(ast);

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

    const mountComponentInline = (
      parentVar: string,
      tag: string,
      a: Record<string, string>
    ) => {
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
      const __C = (${tag});
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
    };

    function walkInline(
      n: Node,
      parentVar: string,
      siblings: Node[],
      idx: number
    ): number {
      if (n.type === "el") {
        const a: any = normalizeAttrs((n as any).attrs || {});

        // clusters on any element
        if (hasIf(a)) {
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
        if (hasSwitch(a)) {
          const { branches, elseChildren, consumedTo } = collectSwitchCluster(
            a["m-switch"],
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
        if (hasFor(a)) {
          const parsed = parseForExpression(a["m-for"]);
          const factory = emitBlockFactory(asChildren(n), [
            parsed.item,
            parsed.index ?? "__i",
          ]);
          emitForBinding(
            (l) => linesBind.push(l),
            use,
            parentVar,
            a["m-for"],
            a["m-key"],
            factory
          );
          return idx;
        }
        if (hasMount(a)) {
          mountComponentInline(parentVar, a["m-mount"], a);
          return idx;
        }
        // <Child/> component tag
        if (isComponentTag((n as any).tag)) {
          mountComponentInline(parentVar, (n as any).tag, a);
          return idx;
        }
      }

      if (n.type === "text") {
        const expr = compileTextExpr(n.value);
        const t = lid("t");
        linesCreate.push(
          `const ${t} = Dom.createText(${expr ? "''" : q(n.value)});`
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
        `const ${el} = Dom.createElement(${q((n as any).tag)});`
      );
      if (scopeAttr)
        linesCreate.push(`Dom.setAttr(${el}, ${q(scopeAttr)}, "");`);

      const attrs = normalizeAttrs((n as any).attrs || {});
      for (const k in attrs) {
        const v = attrs[k];

        if (k === "m-text") {
          const tn = lid("t");
          linesCreate.push(`const ${tn} = Dom.createText('');`);
          linesMount.push(`Dom.insert(${tn}, ${el});`);
          linesBind.push(`__stops.push(bindText(${tn}, () => (${v})));`);
          use("bindText");
          continue;
        }
        if (k === "m-class") {
          linesBind.push(`__stops.push(bindClass(${el}, () => (${v})));`);
          use("bindClass");
          continue;
        }
        if (k === "m-style") {
          linesBind.push(`__stops.push(bindStyle(${el}, () => (${v})));`);
          use("bindStyle");
          continue;
        }
        if (k === "m-show") {
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
            `__stops.push(onEvent(ctx.app, ${el}, ${q(type)}, ${handler}));`
          );
          use("onEvent");
          continue;
        }

        if (k.startsWith("m-")) {
          // generic reactive attr (skip clusters & known)
          if (CLUSTER_KEYS.has(k)) continue;
          const name = k.slice(2);
          if (
            name === "text" ||
            name === "class" ||
            name === "style" ||
            name === "show" ||
            name.startsWith("model")
          ) {
            continue;
          }
          linesBind.push(
            `__stops.push(bindAttr(${el}, ${q(name)}, () => (${v})));`
          );
          use("bindAttr");
          continue;
        }

        linesCreate.push(`Dom.setAttr(${el}, ${q(k)}, ${q(v)});`);
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

  // ---------- now that emitBlockFactory exists, define emitSwitchBinding ----------
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
    if (n.type === "el") {
      const a: any = normalizeAttrs((n as any).attrs || {});

      // clusters on any element at this level
      if (parentVar && siblings && typeof idx === "number") {
        if (hasIf(a)) {
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
        if (hasSwitch(a)) {
          const { branches, elseChildren } = collectSwitchCluster(
            a["m-switch"],
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
        if (hasFor(a)) {
          const parsed = parseForExpression(a["m-for"]);
          const factory = emitBlockFactory(asChildren(n), [
            parsed.item,
            parsed.index ?? "__i",
          ]);
          emitForBinding(
            (l) => mount.push(l),
            use,
            parentVar,
            a["m-for"],
            a["m-key"],
            factory
          );
          return parentVar;
        }
        if (hasMount(a)) {
          // treat element as mount host (props/events from attrs)
          use("effect");
          use("stop");
          const childVar = vid("child");
          const runVar = vid("run");
          const mergedProps = buildMountPropsObject(a);
          mount.push(
            `
{
  let ${childVar} = null;
  const ${runVar} = effect(() => {
    const __p = (${mergedProps});
    if (!${childVar}) {
      const __C = (${a["m-mount"]});
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

      // component tag at this level
      if (isComponentTag((n as any).tag)) {
        const tag = (n as any).tag;
        use("effect");
        use("stop");
        const childVar = vid("child");
        const runVar = vid("run");
        const mergedProps = buildMountPropsObject(a);
        const parentCode = parentVar ? parentVar : "target";
        const anchorArg = parentVar ? "null" : "anchor ?? null";
        mount.push(
          `
{
  let ${childVar} = null;
  const ${runVar} = effect(() => {
    const __p = (${mergedProps});
    if (!${childVar}) {
      const __C = (${tag});
      ${childVar} = __C(__p, { app: ctx.app });
      ${childVar}.mount(${parentCode}, ${anchorArg});
    } else {
      ${childVar}.patch && ${childVar}.patch(__p);
    }
  });
  __stops.push(() => { stop(${runVar}); try { ${childVar} && ${childVar}.destroy && ${childVar}.destroy(); } catch {} });
}
`.trim()
        );
        return parentVar || "";
      }
    }

    if (n.type === "text") {
      if (!n.value || n.value.trim() === "") return parentVar || "";
      const expr = compileTextExpr(n.value);
      const t = vid("t");
      create.push(`const ${t} = Dom.createText(${expr ? "''" : q(n.value)});`);
      if (parentVar) mount.push(`Dom.insert(${t}, ${parentVar});`);
      if (expr) bindings.push({ kind: "text", target: t, expr });
      return t;
    }

    // element (standard DOM)
    const el = vid("e");
    create.push(`const ${el} = Dom.createElement(${q((n as any).tag)});`);
    if (scopeAttr) create.push(`Dom.setAttr(${el}, ${q(scopeAttr)}, "");`);

    const attrs = normalizeAttrs((n as any).attrs || {});
    for (const k in attrs) {
      const v = attrs[k];

      if (k === "m-text") {
        const tn = vid("t");
        create.push(`const ${tn} = Dom.createText('');`);
        mount.push(`Dom.insert(${tn}, ${el});`);
        bindings.push({ kind: "text", target: tn, expr: v });
        continue;
      }
      if (k === "m-class") {
        bindings.push({ kind: "class", target: el, expr: v });
        continue;
      }
      if (k === "m-style") {
        bindings.push({ kind: "style", target: el, expr: v });
        continue;
      }
      if (k === "m-show") {
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

      if (k.startsWith("m-")) {
        // generic reactive attr (skip clusters & known)
        if (CLUSTER_KEYS.has(k)) continue;
        const name = k.slice(2);
        if (
          name === "text" ||
          name === "class" ||
          name === "style" ||
          name === "show" ||
          name.startsWith("model")
        ) {
          continue;
        }
        bindings.push({ kind: "attr", target: el, name, expr: v });
        continue;
      }

      create.push(`Dom.setAttr(${el}, ${q(k)}, ${q(v)});`);
    }

    // handle children including nested clusters/component & mount
    for (let i = 0; i < (n as any).children.length; i++) {
      const c = (n as any).children[i];

      if (c.type === "el") {
        const aChild: any = normalizeAttrs((c as any).attrs || {});
        if (hasIf(aChild)) {
          const { branches, elseChildren, consumedTo } = collectIfCluster(
            (n as any).children,
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
        if (hasSwitch(aChild)) {
          const { branches, elseChildren, consumedTo } = collectSwitchCluster(
            aChild["m-switch"],
            (n as any).children,
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
        if (hasFor(aChild)) {
          const parsed = parseForExpression(aChild["m-for"]);
          const factory = emitBlockFactory(asChildren(c), [
            parsed.item,
            parsed.index ?? "__i",
          ]);
          emitForBinding(
            (l) => mount.push(l),
            use,
            el,
            aChild["m-for"],
            aChild["m-key"],
            factory
          );
          continue;
        }
        if (hasMount(aChild)) {
          use("effect");
          use("stop");
          const mergedProps = buildMountPropsObject(aChild);
          const childVar = vid("child");
          const runVar = vid("run");
          mount.push(
            `
{
  let ${childVar} = null;
  const ${runVar} = effect(() => {
    const __p = (${mergedProps});
    if (!${childVar}) {
      const __C = (${aChild["m-mount"]});
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
        // <Child/> as child component
        if (isComponentTag((c as any).tag)) {
          const tag = (c as any).tag;
          use("effect");
          use("stop");
          const childVar = vid("child");
          const runVar = vid("run");
          const mergedProps = buildMountPropsObject(aChild);
          mount.push(
            `
{
  let ${childVar} = null;
  const ${runVar} = effect(() => {
    const __p = (${mergedProps});
    if (!${childVar}) {
      const __C = (${tag});
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

      const res = walk(c, el, (n as any).children, i);
      if (c.type === "el") mount.push(`Dom.insert(${res}, ${el});`);
    }

    if (parentVar) mount.push(`Dom.insert(${el}, ${parentVar});`);
    return el;
  }

  // ---------- roots ----------
  const roots: string[] = [];
  for (let i = 0; i < ast.length; i++) {
    const n = ast[i];

    if (n.type === "el") {
      const a: any = normalizeAttrs((n as any).attrs || {});

      if (hasIf(a)) {
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
      if (hasSwitch(a)) {
        const { branches, elseChildren, consumedTo } = collectSwitchCluster(
          a["m-switch"],
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
      if (hasFor(a)) {
        const parsed = parseForExpression(a["m-for"]);
        const factory = emitBlockFactory(asChildren(n), [
          parsed.item,
          parsed.index ?? "__i",
        ]);
        emitForBinding(
          (l) => mount.push(l),
          use,
          "target" as any,
          a["m-for"],
          a["m-key"],
          factory
        );
        continue;
      }
      if (hasMount(a)) {
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
      const __C = (${a["m-mount"]});
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

      // Root-level <Child/>
      if (isComponentTag((n as any).tag)) {
        const tag = (n as any).tag;
        use("effect");
        use("stop");
        const childVar = vid("child");
        const runVar = vid("run");
        const mergedProps = buildMountPropsObject(a);
        mount.push(
          `
{
  let ${childVar} = null;
  const ${runVar} = effect(() => {
    const __p = (${mergedProps});
    if (!${childVar}) {
      const __C = (${tag});
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
        has(normalizeAttrs(n.attrs || {}), "m-if") ||
        has(normalizeAttrs(n.attrs || {}), "m-switch") ||
        has(normalizeAttrs(n.attrs || {}), "m-for") ||
        has(normalizeAttrs(n.attrs || {}), "m-mount") ||
        isComponentTag((n as any).tag)
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

  // gather imports needed by top-level bindings
  for (const b of bindings as any[]) {
    switch (b.kind) {
      case "text":
        extraImports.add("bindText");
        break;
      case "class":
        extraImports.add("bindClass");
        break;
      case "style":
        extraImports.add("bindStyle");
        break;
      case "show":
        extraImports.add("bindShow");
        break;
      case "attr":
        extraImports.add("bindAttr");
        break;
      case "event":
        extraImports.add("onEvent");
        break;
      case "model":
        extraImports.add("bindModel");
        break;
    }
  }

  (ir as any).imports = Array.from(extraImports);
  (ir as any).warnings = warnings.map(w => w.message);
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
    if (parent && parent.type === "el") (parent as any).children.push(n);
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
        if (top.type === "el" && (top as any).tag === tag) break;
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
