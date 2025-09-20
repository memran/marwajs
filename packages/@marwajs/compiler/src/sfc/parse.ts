// parse.ts
// Super-tiny SFC splitter. Handles <template>, <script ...>, <style ...> blocks.
// Now supports nested <template> tags inside the main <template> (e.g., control-flow <template :if> ...).

export interface SFCDescriptor {
  file: string;
  template: { content: string };
  script: { content: string; attrs: Record<string, string | true> };
  style: { content: string; attrs: Record<string, string | true> } | null;
}

export function parseSFC(code: string, file: string): SFCDescriptor {
  function blk(name: string) {
    const open = findOpeningTag(code, name, 0);
    if (!open) return null;

    const startIdx = open.end; // after '>'
    const close =
      name.toLowerCase() === "template"
        ? findMatchingCloseWithDepth(code, name, startIdx) // allow nested <template>
        : findClosingTag(code, name, startIdx); // simple (no nesting)

    if (!close)
      throw new Error(`[SFC] Missing </${name}> for <${name}> in ${file}`);

    const content = code.slice(startIdx, close.start);
    return { content, attrs: open.attrs };
  }

  const t = blk("template");
  if (!t) throw new Error(`[SFC] <template> missing in ${file}`);

  const s = blk("script");
  const st = blk("style");

  return {
    file,
    template: { content: t.content.trim() },
    script: { content: (s?.content ?? "").trim(), attrs: s?.attrs ?? {} },
    style: st ? { content: st.content.trim(), attrs: st.attrs } : null,
  };
}

function parseAttrs(raw: string): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  if (!raw) return out;
  const re = /([:@.\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? m[4];
    out[key] = val ?? true;
  }
  return out;
}

// ---- helpers ----

type OpeningTag = {
  start: number;
  end: number;
  attrs: Record<string, string | true>;
};
type ClosingTag = { start: number; end: number };

function findOpeningTag(
  src: string,
  name: string,
  from: number
): OpeningTag | null {
  const n = name.toLowerCase();
  let i = from;
  let inQuote: '"' | "'" | null = null;

  while (i < src.length) {
    const ch = src[i];

    if (ch === '"' || ch === "'") {
      if (inQuote === ch) inQuote = null;
      else if (!inQuote) inQuote = ch;
      i++;
      continue;
    }

    if (!inQuote && ch === "<") {
      if (
        startsWithIgnoreCase(src, i + 1, n) &&
        isBoundary(src, i + 1 + n.length)
      ) {
        // found "<name"
        const attrsStart = i + 1 + n.length;
        const endOfTag = scanToTagEnd(src, attrsStart);
        const rawAttrs = src.slice(attrsStart, endOfTag).trim();
        return { start: i, end: endOfTag + 1, attrs: parseAttrs(rawAttrs) };
      }
    }
    i++;
  }
  return null;
}

function findClosingTag(
  src: string,
  name: string,
  from: number
): ClosingTag | null {
  const n = name.toLowerCase();
  let i = from;
  let inQuote: '"' | "'" | null = null;

  while (i < src.length) {
    const ch = src[i];

    if (ch === '"' || ch === "'") {
      if (inQuote === ch) inQuote = null;
      else if (!inQuote) inQuote = ch;
      i++;
      continue;
    }

    if (!inQuote && ch === "<" && src[i + 1] === "/") {
      if (
        startsWithIgnoreCase(src, i + 2, n) &&
        isBoundary(src, i + 2 + n.length)
      ) {
        const endOfTag = scanToTagEnd(src, i + 2 + n.length);
        return { start: i, end: endOfTag + 1 };
      }
    }
    i++;
  }
  return null;
}

function findMatchingCloseWithDepth(
  src: string,
  name: string,
  from: number
): ClosingTag | null {
  const n = name.toLowerCase();
  let depth = 1;
  let i = from;
  let inQuote: '"' | "'" | null = null;

  while (i < src.length) {
    const ch = src[i];

    if (ch === '"' || ch === "'") {
      if (inQuote === ch) inQuote = null;
      else if (!inQuote) inQuote = ch;
      i++;
      continue;
    }

    if (!inQuote && ch === "<") {
      // opening
      if (
        startsWithIgnoreCase(src, i + 1, n) &&
        isBoundary(src, i + 1 + n.length)
      ) {
        // self-closing <template .../> is not expected, but still consume to '>'
        const endOpen = scanToTagEnd(src, i + 1 + n.length);
        depth++;
        i = endOpen + 1;
        continue;
      }
      // closing
      if (
        src[i + 1] === "/" &&
        startsWithIgnoreCase(src, i + 2, n) &&
        isBoundary(src, i + 2 + n.length)
      ) {
        const endClose = scanToTagEnd(src, i + 2 + n.length);
        depth--;
        if (depth === 0) {
          return { start: i, end: endClose + 1 };
        }
        i = endClose + 1;
        continue;
      }
    }

    i++;
  }
  return null;
}

function scanToTagEnd(src: string, from: number): number {
  let i = from;
  let inQuote: '"' | "'" | null = null;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      if (inQuote === ch) inQuote = null;
      else if (!inQuote) inQuote = ch;
      continue;
    }
    if (ch === ">" && !inQuote) return i;
  }
  return src.length - 1;
}

function startsWithIgnoreCase(src: string, pos: number, word: string): boolean {
  return src.substr(pos, word.length).toLowerCase() === word;
}

function isBoundary(src: string, pos: number): boolean {
  const ch = src[pos];
  return ch == null || /\s|\/|>/.test(ch);
}
