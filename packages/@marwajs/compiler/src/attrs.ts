import { CompilerError, ensure } from "./errors";

/** Normalize attributes; never returns null/undefined values. */
export function normalizeAttributes(
  input: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(input ?? {})) {
    const raw = (input as any)[key];
    if (raw == null)
      throw new CompilerError(
        `Attribute "${key}" must not be null or undefined.`
      );
    if (Array.isArray(raw)) {
      out[key] = raw
        .map((v) => ensure(String(v), `attribute:${key}`))
        .join(" ");
      continue;
    }
    if (typeof raw === "boolean") {
      out[key] = raw ? "" : "";
      continue;
    }
    out[key] = String(raw);
  }
  return out;
}
