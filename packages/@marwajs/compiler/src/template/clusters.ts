import type { Node, Branch } from "./types";
import { normalizeAttrs } from "./attrs";

// keys that should not turn into generic m-* props/attrs
export const CLUSTER_KEYS = new Set([
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

export const hasIf = (a: any) => typeof a["m-if"] === "string";
export const hasElseIf = (a: any) =>
  Object.prototype.hasOwnProperty.call(a, "m-else-if");
export const hasElse = (a: any) =>
  Object.prototype.hasOwnProperty.call(a, "m-else");
export const hasSwitch = (a: any) => typeof a["m-switch"] === "string";
export const hasCase = (a: any) =>
  Object.prototype.hasOwnProperty.call(a, "m-case");
export const hasDefault = (a: any) =>
  Object.prototype.hasOwnProperty.call(a, "m-default");
export const hasFor = (a: any) => typeof a["m-for"] === "string";
export const hasKey = (a: any) => typeof a["m-key"] === "string";
export const hasMount = (a: any) => typeof a["m-mount"] === "string";

// IMPORTANT: shallow clone that STRIPS cluster keys (matches original behavior)
function cloneNodeShallow(n: Node): Node {
  if (n.type === "text") return { type: "text", value: n.value };
  const src: any = n;
  const attrs: Record<string, string> = {};
  for (const k in src.attrs) {
    if (!CLUSTER_KEYS.has(k)) attrs[k] = src.attrs[k];
  }
  return { type: "el", tag: src.tag, attrs, children: src.children };
}

// Use the node itself as branch content when cluster is on a non-template
export function asChildren(n: Node): Node[] {
  if (n.type === "el" && (n as any).tag === "template")
    return (n as any).children;
  return [cloneNodeShallow(n)];
}

// :for expression parser
export function parseForExpression(src: string): {
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

export function collectIfCluster(
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

export function collectSwitchCluster(
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
