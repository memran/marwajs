import type { ComponentIR, Binding } from "../ir";

type Node =
  | { type: "el"; tag: string; attrs: Record<string, string>; children: Node[] }
  | { type: "text"; value: string };

export function compileTemplateToIR(
  html: string,
  { file, name, scopeAttr }: { file: string; name: string; scopeAttr?: string }
): ComponentIR {
  const ast = parseHTML(html);
  const create: string[] = [];
  const mount: string[] = [];
  const bindings: Binding[] = [];

  let id = 0;
  const vid = (p: string) => `_${p}${++id}`;

  function compileTextExpr(raw: string): string | null {
    // Split by {{ expr }} and return a template literal expression
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
    if (!parts.length && !tail) return null; // no dynamic
    if (tail) parts.push(tail.replace(/`/g, "\\`"));
    // If there were no {{}} but we had raw, return null (static text node will be used)
    if (parts.length === 1 && !/\$\{/.test(parts[0])) return null;
    return "`" + parts.join("") + "`";
  }

  function walk(n: Node, parentVar?: string): string {
    if (n.type === "text") {
      // Ignore pure whitespace nodes to avoid noise; keep others intact
      if (!n.value || n.value.trim() === "") return parentVar || "";
      const expr = compileTextExpr(n.value);
      const t = vid("t");
      create.push(
        `const ${t} = Dom.createText(${expr ? "''" : JSON.stringify(n.value)});`
      );
      if (parentVar) mount.push(`Dom.insert(${t}, ${parentVar});`);
      if (expr) bindings.push({ kind: "text", target: t, expr });
      return t;
    }

    // element
    const el = vid("e");
    create.push(`const ${el} = Dom.createElement(${JSON.stringify(n.tag)});`);
    if (scopeAttr)
      create.push(`Dom.setAttr(${el}, ${JSON.stringify(scopeAttr)}, "");`);

    // attributes & directives
    const attrs = n.attrs || {};
    for (const k in attrs) {
      const v = attrs[k];
      if (k === ":text") {
        const tn = vid("t");
        create.push(`const ${tn} = Dom.createText('');`);
        mount.push(`Dom.insert(${tn}, ${el});`);
        bindings.push({ kind: "text", target: tn, expr: v });
      } else if (k === ":class") {
        bindings.push({ kind: "class", target: el, expr: v });
      } else if (k === ":style") {
        bindings.push({ kind: "style", target: el, expr: v });
      } else if (k === ":show") {
        bindings.push({ kind: "show", target: el, expr: v });
      } else if (k === "m-model") {
        bindings.push({
          kind: "model",
          target: el,
          get: v,
          set: "$_",
          options: {},
        });
      } else if (k.startsWith("@")) {
        // Support modifiers: @click.prevent.stop
        const raw = k.slice(1);
        const [type, ...mods] = raw.split(".");
        const handler = `(e)=>{ ${v} }`;
        if (mods.length) {
          const arr = `[${mods.map((m) => `'${m}'`).join(",")}]`;
          bindings.push({
            kind: "event",
            target: el,
            type,
            handler: `withModifiers(${handler}, ${arr})`,
          });
        } else {
          bindings.push({ kind: "event", target: el, type, handler });
        }
      } else {
        // static attr
        create.push(
          `Dom.setAttr(${el}, ${JSON.stringify(k)}, ${JSON.stringify(v)});`
        );
      }
    }

    for (const c of n.children) {
      const childVar = walk(c, el);
      if (c.type === "el") {
        mount.push(`Dom.insert(${childVar}, ${el});`);
      }
    }

    if (parentVar) mount.push(`Dom.insert(${el}, ${parentVar});`);
    return el;
  }

  const roots: string[] = [];
  for (const c of ast) roots.push(walk(c));

  const rootMounts = roots.map(
    (r) => `Dom.insert(${r}, target, anchor ?? null);`
  );

  const ir: ComponentIR = {
    file,
    name,
    create,
    mount: [...rootMounts, ...mount], // include child mounts collected during walk
    bindings,
  };
  return ir;
}

// --- minimal HTML tokenizer (keeps meaningful spaces) ---
function parseHTML(src: string): Node[] {
  const re = /<\/?([A-Za-z][\w-]*)([^>]*)>|([^<]+)/g;
  //const attrRe = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=]+)))?/g;
  const attrRe = /([:@.\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=]+)))?/g;
  const stack: Node[] = [];
  const roots: Node[] = [];

  function push(n: Node) {
    const parent = stack[stack.length - 1];
    if (parent && parent.type === "el") parent.children.push(n);
    else roots.push(n);
  }

  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[3]) {
      const txt = m[3];
      if (txt && txt.trim() !== "") push({ type: "text", value: txt });
      continue;
    }
    const tag = m[1];
    const rawAttrs = m[2] ?? "";
    if (m[0][1] === "/") {
      while (stack.length) {
        const top = stack.pop()!;
        if (top.type === "el" && top.tag === tag) break;
      }
    } else {
      const attrs: Record<string, string> = {};
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(rawAttrs))) {
        const k = a[1];
        const v = a[2] ?? a[3] ?? a[4] ?? "";
        attrs[k] = v;
      }
      const el: Node = { type: "el", tag, attrs, children: [] };
      push(el);
      const selfClose = /\/\s*>$/.test(m[0]) || isVoid(tag);
      if (!selfClose) stack.push(el);
    }
  }
  return roots;
}

function isVoid(tag: string) {
  return /^(br|hr|img|input|meta|link|source|area|base|col|embed|param|track|wbr)$/i.test(
    tag
  );
}
