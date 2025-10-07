import { CompilerError } from "./errors";

/** Parts of a text node after splitting static and {{ expr }} chunks. */
export type TextPart =
  | { kind: "static"; value: string }
  | { kind: "expr"; value: string };

const INTERP_SINGLE = /\{\{([\s\S]+?)\}\}/; // legacy single match
const INTERP_GLOBAL = /\{\{([\s\S]+?)\}\}/g; // multi-match splitter

/**
 * NEW: Split a raw text into a sequence of static and expression parts.
 * - Preserves all static text.
 * - Yields one {kind:"expr"} per {{ ... }}.
 * - Throws on empty {{ }}.
 */
export function splitTextExpressionParts(raw: string): TextPart[] {
  if (raw == null)
    throw new CompilerError("Text node value must not be null or undefined.");

  const parts: TextPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = INTERP_GLOBAL.exec(raw))) {
    const start = m.index;
    const end = start + m[0]!.length;

    if (start > last) {
      const staticText = raw.slice(last, start);
      if (staticText) parts.push({ kind: "static", value: staticText });
    }

    const expr = (m[1] ?? "").trim();
    if (!expr)
      throw new CompilerError("Empty interpolation is not allowed: {{ }}");
    parts.push({ kind: "expr", value: expr });

    last = end;
  }

  if (last < raw.length) {
    const tail = raw.slice(last);
    if (tail) parts.push({ kind: "static", value: tail });
  }

  if (parts.length === 0) return [{ kind: "static", value: raw }];
  return parts;
}

/**
 * EXISTING (kept for compatibility): return the first {{ expr }} or null.
 * Used by legacy call sites; safe to keep while we migrate.
 */
export function compileTextExpression(raw: string): string | null {
  if (raw == null)
    throw new CompilerError("Text node value must not be null or undefined.");
  const m = raw.match(INTERP_SINGLE);
  if (!m) return null;
  const expr = (m[1] ?? "").trim();
  if (!expr)
    throw new CompilerError("Empty interpolation is not allowed: {{ }}");
  return expr;
}
