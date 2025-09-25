import type { Node } from "./types";

const UPPER_TAG_RE = /^[A-Z]/;

export const has = (o: any, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

export const q = JSON.stringify;

export const trimOr = (s: any, fallback = "") =>
  typeof s === "string" ? s.trim() : fallback;

export const isComponentTag = (tag: string) => UPPER_TAG_RE.test(tag);

/**
 * String interpolation compiler for text nodes
 */
export function compileTextExpr(raw: string): string | null {
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
