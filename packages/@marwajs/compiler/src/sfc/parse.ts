// Super-tiny SFC splitter. Handles <template>, <script ...>, <style ...> blocks.
// Not a full HTML parser—good enough for our build (no nested SFC blocks).
export interface SFCDescriptor {
  file: string;
  template: { content: string };
  script: { content: string; attrs: Record<string, string | true> };
  style: { content: string; attrs: Record<string, string | true> } | null;
}

export function parseSFC(code: string, file: string): SFCDescriptor {
  function blk(name: string) {
    const openTag = new RegExp(`<${name}([^>]*)>`, "ig");
    let m: RegExpExecArray | null;
    while ((m = openTag.exec(code))) {
      const rawAttrs = (m[1] ?? "").trim();

      // find true end of opening tag (handles > inside quotes)
      let startIdx = m.index! + m[0].length;
      {
        let i = m.index! + name.length + 1; // after <name
        let inQuote: '"' | "'" | null = null;
        for (; i < code.length; i++) {
          const ch = code[i];
          if (ch === '"' || ch === "'") {
            if (inQuote === ch) inQuote = null;
            else if (!inQuote) inQuote = ch;
          }
          if (ch === ">" && !inQuote) {
            startIdx = i + 1;
            break;
          }
        }
      }

      // find matching closing tag
      const closeTag = new RegExp(`</${name}>`, "ig");
      closeTag.lastIndex = startIdx;
      const cm = closeTag.exec(code);
      if (!cm)
        throw new Error(`[SFC] Missing </${name}> for <${name}> in ${file}`);

      const endIdx = cm.index;
      const content = code.slice(startIdx, endIdx);
      return { content, attrs: parseAttrs(rawAttrs) };
    }
    return null;
  }

  const t = blk("template");
  if (!t) throw new Error(`[SFC] <template> missing in ${file}`);
  const s = blk("script");
  const st = blk("style");

  return {
    file,
    template: { content: t.content.trim() },
    script: {
      content: (s?.content ?? "").trim(),
      attrs: s?.attrs ?? {},
    },
    style: st ? { content: st.content.trim(), attrs: st.attrs } : null,
  };
}

function parseAttrs(raw: string): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  if (!raw) return out;
  //const re = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=]+)))?/g;
  const re = /([:@.\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? m[4];
    out[key] = val ?? true;
  }
  return out;
}
