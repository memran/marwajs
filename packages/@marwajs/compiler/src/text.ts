import { CompilerError } from "./errors";
const INTERP = /\{\{([\s\S]+?)\}\}/;
/** Extract a single interpolation expression or null if none; throws on empty. */
export function compileTextExpression(raw: string): string | null {
  if (raw == null)
    throw new CompilerError("Text node value must not be null or undefined.");
  const m = raw.match(INTERP);
  if (!m) return null;
  if (m[1] == null) throw new CompilerError("Interpolation capture missing.");
  const expr = m[1].trim();
  if (!expr)
    throw new CompilerError("Empty interpolation is not allowed: {{ }}");
  return expr;
}
