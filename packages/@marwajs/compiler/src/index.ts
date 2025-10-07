import { parseHTML } from "./html/parse";
import { normalizeAttributes } from "./attrs";
import { splitTextExpressionParts } from "./text"; // <- keep old, add new
import { parseEventAttribute } from "./events";
import { CompilerError, NullOrUndefinedError } from "./errors";
import type { TemplateNode, CompileOptions } from "./types";
import type { ComponentIR, Binding } from "./ir";
import { generateComponent } from "./codegen";
import { parseSFC, transpileScript } from "./sfc/parseSFC";

export function compileTemplateToIR(
  html: string,
  { file, name, scopeAttr, strict = true }: CompileOptions
): ComponentIR {
  if (!file) throw new CompilerError("Option 'file' must be provided.");
  if (!name) throw new CompilerError("Option 'name' must be provided.");

  const ast = parseHTML(html);
  const create: string[] = [];
  const mount: string[] = [];
  const bindings: Binding[] = [];
  const imports = new Set<string>(["Dom"]);

  let id = 0;
  const uid = (p: string) => `_${p}${++id}`;

  const insert = (child: string, parent: string, withAnchor = false) =>
    mount.push(
      withAnchor
        ? `Dom.insert(${child}, ${parent}, anchor ?? null);`
        : `Dom.insert(${child}, ${parent});`
    );

  const walk = (n: TemplateNode, parent?: string): string => {
    // TEXT NODES — now support mixed static + {{ expr }} parts
    if (n.type === "text") {
      const parts = splitTextExpressionParts(n.value);
      let last = "";
      for (const p of parts) {
        const t = uid("text");
        if (p.kind === "static") {
          create.push(
            `const ${t} = Dom.createText(${JSON.stringify(p.value)});`
          );
          if (parent) insert(t, parent);
        } else {
          create.push(`const ${t} = Dom.createText('');`);
          if (parent) insert(t, parent);
          bindings.push({ kind: "text", target: t, expr: p.value });
          imports.add("bindText");
        }
        last = t;
      }
      return last;
    }

    // ELEMENT NODES — unchanged
    const el = uid("el");
    create.push(`const ${el} = Dom.createElement(${JSON.stringify(n.tag)});`);
    if (scopeAttr)
      create.push(`Dom.setAttr(${el}, ${JSON.stringify(scopeAttr)}, "");`);

    const a = normalizeAttributes(n.attrs || {});
    for (const k of Object.keys(a)) {
      const v = a[k];
      if (strict && (v as any) == null)
        throw new NullOrUndefinedError(`Attribute ${k} has nullish value.`);
      if (v == undefined)
        throw new NullOrUndefinedError(`Attribute ${k} has undefined value.`);

      if (k === "m-text") {
        const tn = uid("text");
        create.push(`const ${tn} = Dom.createText('');`);
        insert(tn, el);
        bindings.push({ kind: "text", target: tn, expr: v });
        imports.add("bindText");
        continue;
      }
      if (k === "m-class") {
        bindings.push({ kind: "class", target: el, expr: v });
        imports.add("bindClass");
        continue;
      }
      if (k === "m-style") {
        bindings.push({ kind: "style", target: el, expr: v });
        imports.add("bindStyle");
        continue;
      }
      if (k === "m-show") {
        bindings.push({ kind: "show", target: el, expr: v });
        imports.add("bindShow");
        continue;
      }

      if (k.startsWith("@")) {
        const { type } = parseEventAttribute(k);
        bindings.push({ kind: "event", target: el, type, handler: v });
        imports.add("onEvent");
        continue;
      }
      if (k.startsWith("m-")) {
        const name = k.slice(2);
        if (!name)
          throw new CompilerError("m- attribute must have a name, e.g., m-id");
        bindings.push({ kind: "attr", target: el, name, expr: v });
        imports.add("bindAttr");
        continue;
      }
      create.push(
        `Dom.setAttr(${el}, ${JSON.stringify(k)}, ${JSON.stringify(v)});`
      );
    }

    for (const c of n.children) {
      const res = walk(c, el);
      if (c.type === "el") insert(res, el);
    }

    if (parent) insert(el, parent);
    return el;
  };

  for (const n of ast) {
    const r = walk(n);
    if (n.type === "el")
      mount.push(`Dom.insert(${r}, target, anchor ?? null);`);
  }

  return { file, name, create, mount, bindings, imports: Array.from(imports) };
}

export function compileSFC(source: string, file: string): { code: string } {
  const sfc = parseSFC(source, file);
  const ir = compileTemplateToIR(sfc.template, { file, name: toName(file) });
  const js = generateComponent(ir);
  const user = transpileScript(sfc.script, file);
  return { code: user ? `${user}\n\n${js}` : js };
}

function toName(file: string): string {
  const base = (file.split(/[\\/]/).pop() || "Component").replace(
    /\.[^.]+$/,
    ""
  );
  if (!base)
    throw new CompilerError("Unable to derive component name from file path.");
  return base;
}
