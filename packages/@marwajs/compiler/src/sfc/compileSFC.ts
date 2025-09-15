// packages/@marwajs/compiler/src/sfc/compileSFC.ts
import { parseSFC } from "./parse";
import { compileTemplateToIR } from "../template/compile";
import { generateComponent } from "../codegen";
import crypto from "node:crypto";

export function compileSFC(code: string, file: string): { code: string } {
  const sfc = parseSFC(code, file);

  // Scoped CSS: stamp a unique attr on all elements in this SFC
  const scoped = !!sfc.style?.attrs?.scoped;
  const scopeAttr = scoped
    ? `data-mw-${hash(file + (sfc.style?.content ?? ""))}`
    : undefined;

  // Hoist imports from <script>, keep the rest as setup prelude
  const { hoisted, setup } = splitScript(sfc.script.content);

  // Template → IR
  const ir: any = compileTemplateToIR(sfc.template.content, {
    file: sfc.file,
    name: guessName(file),
    scopeAttr,
  });

  // ----- Scoped CSS injection (once per SFC instance) -----
  // We generate a tiny prelude that injects a single <style> tag into <head>.
  // - attrId (with hyphens) is used only in DOM attributes
  // - h (hash) is used for JS identifiers (no hyphens)
  let stylePrelude = "";
  if (sfc.style?.content) {
    const css = scoped
      ? scopeCSS(sfc.style.content, scopeAttr!)
      : sfc.style.content;

    const h = hash(file); // e.g. "a1b2c3d4"
    const attrId = `mw-style-${h}`; // used in <style data-mw-id="...">
    const varOnce = `__mw_style_once_${h}`; // JS identifier (no hyphens)
    const fnInject = `__mw_inject_${h}`; // JS identifier (no hyphens)

    stylePrelude = `
let ${varOnce} = false;
function ${fnInject}(){
  if (${varOnce}) return; ${varOnce} = true;
  if (typeof document !== 'undefined') {
    const s = document.createElement('style');
    s.setAttribute('data-mw-id','${attrId}');
    s.textContent = ${JSON.stringify(css)};
    document.head.appendChild(s);
  }
}
${fnInject}();
`.trim();
  }

  // Allow <script> (setup) and style prelude to run inside component setup
  ir.prelude = [stylePrelude, setup].filter(Boolean);
  ir.imports = []; // runtime imports are inferred by codegen from bindings

  // IR → ESM
  const { code: componentCode } = generateComponent(ir);

  // Join hoisted user imports + generated component body
  const module = [...hoisted, componentCode].join("\n");

  return { code: module };
}

/** Split <script> into hoisted import lines and the rest (setup body). */
function splitScript(src: string): { hoisted: string[]; setup: string } {
  const lines = (src || "").split("\n");
  const hoisted: string[] = [];
  const rest: string[] = [];
  for (const l of lines) {
    if (/^\s*import\s/.test(l)) hoisted.push(l);
    else if (l.trim()) rest.push(l);
  }
  return { hoisted, setup: rest.join("\n") };
}

function hash(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);
}

function guessName(file: string): string {
  const base = file.split(/[\\/]/).pop() || "Component";
  return base.replace(/\.[^.]+$/, "");
}

/**
 * Very small CSS scoper:
 * - Prefixes simple selectors with [attr]
 * - Recursively handles @media / @supports blocks
 * - Leaves @keyframes bodies untouched
 */
function scopeCSS(css: string, attr: string): string {
  const scoped = `[${attr}]`;
  const out: string[] = [];
  let i = 0;

  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) {
      out.push(css.slice(i));
      break;
    }
    const header = css.slice(i, open).trim();
    const close = findMatchingBrace(css, open);
    const body = css.slice(open + 1, close).trim();

    if (/^@keyframes/i.test(header)) {
      out.push(header, "{", body, "}");
    } else if (/^@/i.test(header)) {
      // e.g. @media (...) { ... }  → scope the inner rules
      out.push(header, "{", scopeCSS(body, attr), "}");
    } else {
      // Selector list: prefix each with the scoped attribute
      const scopedHeader = header
        .split(",")
        .map((s) => `${scoped} ${s.trim()}`)
        .join(", ");
      out.push(scopedHeader, "{", body, "}");
    }
    i = close + 1;
  }

  return out.join("");
}

function findMatchingBrace(css: string, openIdx: number): number {
  let depth = 0;
  for (let j = openIdx; j < css.length; j++) {
    const ch = css[j];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return css.length - 1;
}
