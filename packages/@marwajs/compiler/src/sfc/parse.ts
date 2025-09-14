// Super-tiny SFC splitter. Handles <template>, <script ...>, <style ...> blocks.
// Not a full HTML parser—good enough for our build (no nested SFC blocks).
export interface SFCDescriptor {
  file: string;
  template: { content: string };
  script: { content: string; attrs: Record<string, string | true> };
  style: { content: string; attrs: Record<string, string | true> } | null;
}

export function parseSFC(code: string, file: string): SFCDescriptor {
  const blk = (name: string) => {
    const open = new RegExp(`<${name}([^>]*)>`, 'i');
    const close = new RegExp(`</${name}>`, 'i');
    const m = code.match(open);
    if (!m) return null;
    const start = (m.index ?? 0) + m[0].length;
    const end = code.indexOf(code.match(close)?.[0] ?? `</${name}>`, start);
    const rawAttrs = (m[1] ?? '').trim();
    return {
      content: code.slice(start, end),
      attrs: parseAttrs(rawAttrs)
    };
  };
  const t = blk('template');
  if (!t) throw new Error(`[SFC] <template> missing in ${file}`);
  const s = blk('script');
  const st = blk('style');

  return {
    file,
    template: { content: t.content.trim() },
    script: {
      content: (s?.content ?? '').trim(),
      attrs: s?.attrs ?? {}
    },
    style: st
      ? { content: st.content.trim(), attrs: st.attrs }
      : null
  };
}

function parseAttrs(raw: string): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  if (!raw) return out;
  const re = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? m[4];
    out[key] = val ?? true;
  }
  return out;
}
