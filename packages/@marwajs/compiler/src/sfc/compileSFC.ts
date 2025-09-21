// packages/@marwajs/compiler/src/sfc/compileSFC.ts
import { parseSFC } from "./parse";
import { compileTemplateToIR } from "../template/compile";
import { generateComponent } from "../codegen";
import crypto from "node:crypto";

/**
 * Try to transpile TS/TSX to plain JS.
 * - Prefer Sucrase (fast & tiny).
 * - Fallback to TypeScript transpileModule.
 * - If neither exists and script is TS, throw a helpful error.
 */
function transpileScriptMaybe(src: string, lang?: string | null): string {
  const isTS = lang === "ts" || lang === "tsx";
  if (!isTS) return src;

  // Try Sucrase first
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { transform } = require("sucrase");
    const transforms = lang === "tsx" ? ["typescript", "jsx"] : ["typescript"];
    const out = transform(src, { transforms });
    return out.code;
  } catch (_) {
    // ignore and try TypeScript
  }

  // Fallback: TypeScript
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ts = require("typescript") as typeof import("typescript");
    const out = ts.transpileModule(src, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
        isolatedModules: true,
        useDefineForClassFields: false,
        importHelpers: false,
        esModuleInterop: false,
        downlevelIteration: false,
      },
      reportDiagnostics: false,
    });
    return out.outputText;
  } catch (_) {
    throw new Error(
      `[MarwaJS] <script lang="${lang}"> detected, but no transpiler found.\n` +
        `Please install either "sucrase" or "typescript" as a devDependency.`
    );
  }
}

export function compileSFC(code: string, file: string): { code: string } {
  const sfc = parseSFC(code, file);

  // === Scoped CSS ===
  const scoped = !!sfc.style?.attrs?.scoped;
  const scopeAttr = scoped
    ? `data-mw-${hash(file + (sfc.style?.content ?? ""))}`
    : undefined;

  // === Script (transpile first if TS), then split ===
  const rawScript = sfc.script?.content ?? "";
  const scriptLang = sfc.script?.attrs?.lang ?? null;

  // Transpile the WHOLE script so type-only imports & annotations vanish
  const scriptJS = transpileScriptMaybe(rawScript, scriptLang);

  // Now split transpiled JS into hoisted imports & setup body
  const { hoisted, setup } = splitScript(scriptJS);

  // === Template → IR ===
  const ir: any = compileTemplateToIR(sfc.template?.content ?? "", {
    file: sfc.file,
    name: guessName(file),
    scopeAttr,
  });

  // ===== Scoped CSS injector prelude (once per SFC instance) =====
  let stylePrelude = "";
  if (sfc.style?.content) {
    const css = scoped
      ? scopeCSS(sfc.style.content, scopeAttr!)
      : sfc.style.content;

    const h = hash(file);
    const attrId = `mw-style-${h}`;
    const varOnce = `__mw_style_once_${h}`;
    const fnInject = `__mw_inject_${h}`;

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
  // IMPORTANT: do NOT overwrite ir.imports here; template compiler may have set helpers.
  ir.prelude = [stylePrelude, setup].filter(Boolean);

  // === IR → component module body ===
  const { code: componentCode } = generateComponent(ir);

  // === Join hoisted imports (already JS) + component body ===
  const module = [...hoisted, componentCode].join("\n");

  return { code: module };
}

/** Split script into hoisted import lines and the rest (setup body). Input must be JS already. */
function splitScript(src: string): { hoisted: string[]; setup: string } {
  const lines = (src || "").split("\n");
  const hoisted: string[] = [];
  const rest: string[] = [];
  for (const l of lines) {
    // Keep only real JS imports (TS type imports were removed by transpile step)
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
