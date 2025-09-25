import type { Branch } from "./types.js";
import { CLUSTER_KEYS, parseForExpression } from "./clusters.js";
import { trimOr } from "./../template/utils.js";

/**
 * Emits a bindFor(...) statement given a factory string.
 */
export function emitForBinding(
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

/**
 * Build props object for component mounting from m-props + m-* + @event
 */
export function buildMountPropsObject(attrs: Record<string, string>): string {
  const baseProps = trimOr(attrs["m-props"], "{}");
  const pairs: string[] = [];

  // include m-* (except clusters and known reactive keys)
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

  // @event -> onX
  for (const k in attrs) {
    if (!k.startsWith("@")) continue;
    const raw = k.slice(1);
    const parts = raw.split(".");
    const ev = parts.shift()!;
    const propName = "on" + ev[0].toUpperCase() + ev.slice(1);
    const body = attrs[k] || "";
    const handler = `(e)=>{ ${body.replace(/\$event/g, "e")} }`;
    pairs.push(`${JSON.stringify(propName)}: ${handler}`);
  }

  return pairs.length > 0
    ? `Object.assign({}, (${baseProps}), { ${pairs.join(", ")} })`
    : `(${baseProps})`;
}

/**
 * Factory for emitSwitchBinding so it can close over a block-factory impl.
 */
export function makeEmitSwitchBinding(
  emitBlockFactory: (children: any[]) => string
) {
  return function emitSwitchBinding(
    push: (line: string) => void,
    use: (n: string) => void,
    parentVar: string,
    branches: Branch[],
    elseChildren?: any[]
  ) {
    use("bindSwitch");
    const rec = (b: Branch) =>
      `{ when: (${b.when}), factory: (${emitBlockFactory(b.children)}) }`;
    const arr = `[${branches.map(rec).join(", ")}]`;
    if (elseChildren && elseChildren.length) {
      const ef = emitBlockFactory(elseChildren);
      push(`__stops.push(bindSwitch(${parentVar}, ${arr}, ${ef}));`);
    } else {
      push(`__stops.push(bindSwitch(${parentVar}, ${arr}));`);
    }
  };
}
