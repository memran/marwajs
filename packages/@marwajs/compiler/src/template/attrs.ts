export function normalizeAttrKey(k: string): { key: string; isEvent: boolean } {
  if (k.startsWith(":")) return { key: "m-" + k.slice(1), isEvent: false };
  if (k.startsWith("m-on:")) return { key: "@" + k.slice(5), isEvent: true };
  if (k.startsWith("m-")) return { key: k, isEvent: false };
  if (k.startsWith("@")) return { key: k, isEvent: true };
  return { key: k, isEvent: false };
}

export function normalizeAttrs(
  attrs: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k in attrs) {
    const { key } = normalizeAttrKey(k);
    out[key] = attrs[k];
  }
  return out;
}
