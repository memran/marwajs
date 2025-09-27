// packages/@marwajs/compiler/src/template/compile.ts
import type { ComponentIR, Binding } from "../ir.js";
import type { Node } from "./types.js";

import { q, has, compileTextExpr, isComponentTag } from "./utils.js";
import { splitMods, buildEventHandler } from "./event.js";
import { normalizeAttrs } from "./attrs.js";
import {
  CLUSTER_KEYS,
  asChildren,
  hasIf,
  hasSwitch,
  hasFor,
  hasMount,
  hasCase,
  hasDefault,
  collectIfCluster,
  collectSwitchCluster,
  parseForExpression,
} from "./clusters.js";
import {
  emitForBinding,
  buildMountPropsObject,
  makeEmitSwitchBinding,
} from "./emit.js";
import { parseHTML } from "./html.js";
import { collectWarnings } from "./validation.js";

export function compileTemplateToIR(
  html: string,
  { file, name, scopeAttr }: { file: string; name: string; scopeAttr?: string }
): ComponentIR {
  const ast = parseHTML(html);

  // Non-fatal parser warnings
  const warnings = collectWarnings(ast);

  const create: string[] = [];
  const mount: string[] = [];
  const bindings: Binding[] = [];

  // Runtime imports used by generated code
  const extraImports = new Set<string>(["Dom"]);
  const use = (n: string) => extraImports.add(n);

  let id = 0;
  const vid = (p: string) => `_${p}${++id}`;

  // --- Router special tags helpers ---
  const isRouterViewTag = (tag: string) => tag === "RouterView";
  const isRouterLinkTag = (tag: string) => tag === "RouterLink";
  const ensureLeadingSlashExpr = (expr: string) =>
    `(p=>p&&p[0]==='/'?p:'/'+p)(${expr})`;
  const buildHrefExpr = (toExpr: string) =>
    `((r,p)=>r&&r.mode==='hash'?'#'+p:p)((ctx.app&&ctx.app.router)||router, ${ensureLeadingSlashExpr(
      toExpr
    )})`;
  const pickToExpr = (attrs: Record<string, string>): string | null => {
    if (typeof attrs["m-to"] === "string" && attrs["m-to"].trim().length) {
      return `(${attrs["m-to"]})`;
    }
    if (typeof attrs["to"] === "string") {
      return JSON.stringify(attrs["to"]);
    }
    return null;
  };

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

    const emitSwitchBinding = makeEmitSwitchBinding((kids: Node[]) =>
      emitBlockFactory(kids)
    );

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

        // --- Special tag: <RouterView/>
        if (isRouterViewTag((n as any).tag)) {
          const tagExpr = `RouterView((ctx.app&&ctx.app.router)||router)`;
          (function mountRouterView() {
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
      const __C = (${tagExpr});
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
          })();
          return idx;
        }

        // --- Special tag: <RouterLink ...>...</RouterLink>
        if (isRouterLinkTag((n as any).tag)) {
          const raw = n as any;
          const toExpr = pickToExpr(a) ?? JSON.stringify("/");

          // create <a>
          const el = lid("e");
          linesCreate.push(`const ${el} = Dom.createElement("a");`);
          if (scopeAttr)
            linesCreate.push(
              `Dom.setAttr(${el}, ${JSON.stringify(scopeAttr)}, "");`
            );

          // reactive href
          linesBind.push(
            `__stops.push(bindAttr(${el}, "href", () => (${buildHrefExpr(
              toExpr
            )})));`
          );
          use("bindAttr");

          // SPA click
          linesBind.push(
            `__stops.push(onEvent(ctx.app, ${el}, "click", (e)=>{ e.preventDefault(); const __r=(ctx.app&&ctx.app.router)||router; __r && __r.push(${toExpr}); }));`
          );
          use("onEvent");

          // other attrs (skip to/m-to/@click)
          const pass: Record<string, string> = {};
          for (const k in a) {
            if (k === "to" || k === "m-to" || k === "@click") continue;
            pass[k] = a[k];
          }
          for (const k in pass) {
            const v = pass[k];
            if (k.startsWith("m-") && !CLUSTER_KEYS.has(k)) {
              const name = k.slice(2);
              if (
                name === "text" ||
                name === "class" ||
                name === "style" ||
                name === "show" ||
                name.startsWith("model")
              ) {
                // handled specifically below if present
              } else {
                linesBind.push(
                  `__stops.push(bindAttr(${el}, ${JSON.stringify(
                    name
                  )}, () => (${v})));`
                );
                use("bindAttr");
              }
              continue;
            }
            if (k.startsWith("@")) {
              const { type, behavior, keymods } = splitMods(k.slice(1));
              if (type === "click") continue; // already wired
              const handler = buildEventHandler(v, behavior, keymods);
              if (behavior.length) use("withModifiers");
              linesBind.push(
                `__stops.push(onEvent(ctx.app, ${el}, ${JSON.stringify(
                  type
                )}, ${handler}));`
              );
              use("onEvent");
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
            if (k === "m-text") {
              const tn = lid("t");
              linesCreate.push(`const ${tn} = Dom.createText('');`);
              linesMount.push(`Dom.insert(${tn}, ${el});`);
              linesBind.push(`__stops.push(bindText(${tn}, () => (${v})));`);
              use("bindText");
              continue;
            }
            // static attr
            linesCreate.push(
              `Dom.setAttr(${el}, ${JSON.stringify(k)}, ${JSON.stringify(v)});`
            );
          }

          // children
          const kids = raw.children as Node[];
          for (let i = 0; i < kids.length; i++)
            i = walkInline(kids[i], el, kids, i);

          insert(el, parentVar);
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
          if (CLUSTER_KEYS.has(k)) continue;
          const name = k.slice(2);
          if (
            name === "text" ||
            name === "class" ||
            name === "style" ||
            name === "show" ||
            name.startsWith("model")
          )
            continue;
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

  const emitSwitchBinding = makeEmitSwitchBinding((kids: Node[]) =>
    emitBlockFactory(kids)
  );

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

      // --- Special tag: <RouterView/> at this level
      if (isRouterViewTag((n as any).tag)) {
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
      const __C = (RouterView((ctx.app&&ctx.app.router)||router));
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

      // --- Special tag: <RouterLink ...>...</RouterLink> at this level
      if (isRouterLinkTag((n as any).tag)) {
        const toExpr = pickToExpr(a) ?? JSON.stringify("/");

        const el = vid("e");
        create.push(`const ${el} = Dom.createElement("a");`);
        if (scopeAttr)
          create.push(`Dom.setAttr(${el}, ${JSON.stringify(scopeAttr)}, "");`);

        // href binding
        bindings.push({
          kind: "attr",
          target: el,
          name: "href",
          expr: buildHrefExpr(toExpr),
        });

        // SPA click
        const clickHandler = `(e)=>{ e.preventDefault(); const __r=(ctx.app&&ctx.app.router)||router; __r && __r.push(${toExpr}); }`;
        bindings.push({
          kind: "event",
          target: el,
          type: "click",
          handler: clickHandler,
        });

        // pass-through other attrs
        for (const k in a) {
          const v = a[k];
          if (k === "to" || k === "m-to" || k === "@click") continue;

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

          if (k.startsWith("@")) {
            const { type, behavior, keymods } = splitMods(k.slice(1));
            if (type === "click") continue;
            const handler = buildEventHandler(v, behavior, keymods);
            if (behavior.length) use("withModifiers");
            bindings.push({ kind: "event", target: el, type, handler });
            continue;
          }

          if (k.startsWith("m-") && !CLUSTER_KEYS.has(k)) {
            const name = k.slice(2);
            if (
              name === "text" ||
              name === "class" ||
              name === "style" ||
              name === "show" ||
              name.startsWith("model")
            ) {
              // already handled / or not applicable here
            } else {
              bindings.push({ kind: "attr", target: el, name, expr: v });
            }
            continue;
          }

          create.push(
            `Dom.setAttr(${el}, ${JSON.stringify(k)}, ${JSON.stringify(v)});`
          );
        }

        // children
        for (let i = 0; i < (n as any).children.length; i++) {
          const c = (n as any).children[i];
          const res = walk(c, el, (n as any).children, i);
          if (c.type === "el") mount.push(`Dom.insert(${res}, ${el});`);
        }

        if (parentVar) mount.push(`Dom.insert(${el}, ${parentVar});`);
        return el;
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
        if (CLUSTER_KEYS.has(k)) continue;
        const name = k.slice(2);
        if (
          name === "text" ||
          name === "class" ||
          name === "style" ||
          name === "show" ||
          name.startsWith("model")
        )
          continue;
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

      // Root-level <RouterView/>
      if (isRouterViewTag((n as any).tag)) {
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
      const __C = (RouterView((ctx.app&&ctx.app.router)||router));
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

      // Root-level <RouterLink ...>...</RouterLink>
      if (isRouterLinkTag((n as any).tag)) {
        const toExpr = pickToExpr(a) ?? JSON.stringify("/");

        const el = vid("e");
        create.push(`const ${el} = Dom.createElement("a");`);
        if (scopeAttr)
          create.push(`Dom.setAttr(${el}, ${JSON.stringify(scopeAttr)}, "");`);

        bindings.push({
          kind: "attr",
          target: el,
          name: "href",
          expr: buildHrefExpr(toExpr),
        });
        const clickHandler = `(e)=>{ e.preventDefault(); const __r=(ctx.app&&ctx.app.router)||router; __r && __r.push(${toExpr}); }`;
        bindings.push({
          kind: "event",
          target: el,
          type: "click",
          handler: clickHandler,
        });

        // pass-through attrs
        for (const k in a) {
          const v = a[k];
          if (k === "to" || k === "m-to" || k === "@click") continue;

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

          if (k.startsWith("@")) {
            const { type, behavior, keymods } = splitMods(k.slice(1));
            if (type === "click") continue;
            const handler = buildEventHandler(v, behavior, keymods);
            if (behavior.length) use("withModifiers");
            bindings.push({ kind: "event", target: el, type, handler });
            continue;
          }

          if (k.startsWith("m-") && !CLUSTER_KEYS.has(k)) {
            const name = k.slice(2);
            if (
              name === "text" ||
              name === "class" ||
              name === "style" ||
              name === "show" ||
              name.startsWith("model")
            ) {
              // handled above or skipped intentionally
            } else {
              bindings.push({ kind: "attr", target: el, name, expr: v });
            }
            continue;
          }

          create.push(
            `Dom.setAttr(${el}, ${JSON.stringify(k)}, ${JSON.stringify(v)});`
          );
        }

        // children
        for (let j = 0; j < (n as any).children.length; j++) {
          const c = (n as any).children[j];
          const res = walk(c, el, (n as any).children, j);
          if (c.type === "el") mount.push(`Dom.insert(${res}, ${el});`);
        }

        mount.push(`Dom.insert(${el}, target, anchor ?? null);`);
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
        has(normalizeAttrs((n as any).attrs || {}), "m-if") ||
        has(normalizeAttrs((n as any).attrs || {}), "m-switch") ||
        has(normalizeAttrs((n as any).attrs || {}), "m-for") ||
        has(normalizeAttrs((n as any).attrs || {}), "m-mount") ||
        isComponentTag((n as any).tag) ||
        isRouterViewTag((n as any).tag) ||
        isRouterLinkTag((n as any).tag)
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

  // Accumulate required imports
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
  // ✅ ensure RouterView is imported if used
  if (html.includes("<RouterView")) {
    extraImports.add("RouterView");
  }
  if (html.includes("<RouterLink")) {
    extraImports.add("RouterLink");
  }
  (ir as any).imports = Array.from(extraImports);
  (ir as any).warnings = warnings.map((w) => w.message);
  return ir;
}
