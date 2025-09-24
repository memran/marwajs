// packages/@marwajs/compiler/src/sfc/compileSFC.ts
import { parseSFC } from "./parse";
import { compileTemplateToIR } from "../template/compile";
import { generateComponent } from "../codegen";
import crypto from "node:crypto";

/* ----------------------------- small utilities ----------------------------- */

const hash = (s: string) =>
  crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);

const guessName = (file: string) =>
  file
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, "") || "Component";

const isTSLang = (lang?: string | null) => lang === "ts" || lang === "tsx";

const TS_CONFIG = {
  compilerOptions: {
    target: 99, // ts.ScriptTarget.ES2020
    module: 99, // ts.ModuleKind.ESNext
    jsx: 2, // ts.JsxEmit.Preserve
    isolatedModules: true,
    useDefineForClassFields: false,
    importHelpers: false,
    esModuleInterop: false,
    downlevelIteration: false,
  },
  reportDiagnostics: false,
} as const;

const SUCRASE_TRANSFORMS = (lang?: string | null) =>
  lang === "tsx" ? ["typescript", "jsx"] : ["typescript"];

/** Try Sucrase, then TypeScript (only if TS language). Returns original if not TS. */
function transpileScriptMaybe(src: string, lang?: string | null): string {
  if (!isTSLang(lang)) return src;

  // Prefer Sucrase for speed
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { transform } = require("sucrase");
    return transform(src, { transforms: SUCRASE_TRANSFORMS(lang) }).code;
  } catch {}

  // Fallback: TypeScript
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ts = require("typescript");
    return ts.transpileModule(src, TS_CONFIG as any).outputText;
  } catch {
    throw new Error(
      `[MarwaJS] <script lang="${lang}"> detected, but no transpiler found.\n` +
        `Please install either "sucrase" or "typescript" as a devDependency.`
    );
  }
}

/** Split top-level import lines (hoisted) from the rest (setup). */
function splitScript(src: string): { hoisted: string[]; setup: string } {
  const lines = (src || "").split("\n");
  const hoisted: string[] = [];
  const rest: string[] = [];
  for (const line of lines) {
    (/^\s*import\s/.test(line) ? hoisted : rest).push(line);
  }
  return { hoisted, setup: rest.join("\n") };
}

/* --------------------------------- CSS scope -------------------------------- */

/** Scope CSS to `[attr]`, handling nested blocks & @-rules. */
function scopeCSS(css: string, attr: string): string {
  if (!css) return css;
  const scoped = `[${attr}]`;
  let i = 0;
  const out: string[] = [];

  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) {
      out.push(css.slice(i));
      break;
    }
    const header = css.slice(i, open).trim();
    const close = matchBrace(css, open);
    const body = css.slice(open + 1, close).trim();

    if (/^@keyframes/i.test(header)) {
      // @keyframes should not be scoped
      out.push(header, "{", body, "}");
    } else if (/^@/i.test(header)) {
      // Nesting inside @media / @supports etc.
      out.push(header, "{", scopeCSS(body, attr), "}");
    } else {
      // Normal selectors: prefix each selector with [attr]
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

function matchBrace(css: string, openIdx: number): number {
  let depth = 0;
  for (let j = openIdx; j < css.length; j++) {
    const ch = css[j];
    if (ch === "{") depth++;
    else if (ch === "}") {
      if (--depth === 0) return j;
    }
  }
  return css.length - 1;
}

/* ------------------------------ style prelude ------------------------------ */

/** Generate a once-only style injection prelude. */
function makeStylePrelude(
  style: string,
  file: string,
  scoped: boolean,
  scopeAttr?: string
): string {
  if (!style) return "";
  const css = scoped && scopeAttr ? scopeCSS(style, scopeAttr) : style;
  const h = hash(file);
  const once = `__mw_style_once_${h}`;
  const inject = `__mw_inject_${h}`;

  return `
let ${once} = false;
function ${inject}(){
  if (${once}) return; 
  ${once} = true;
  if (typeof document !== 'undefined') {
    const s = document.createElement('style');
    s.setAttribute('data-mw-id','mw-style-${h}');
    s.textContent = ${JSON.stringify(css)};
    document.head.appendChild(s);
  }
}
${inject}();
`.trim();
}

/* ---------------------------------- compile --------------------------------- */

export function compileSFC(code: string, file: string): { code: string } {
  const sfc = parseSFC(code, file);

  // style scoping
  const scoped = !!sfc.style?.attrs?.scoped;
  const scopeAttr = scoped
    ? `data-mw-${hash(file + (sfc.style?.content ?? ""))}`
    : undefined;

  // script (transpile + split)
  const scriptLang =
    typeof sfc.script?.attrs?.lang === "string"
      ? sfc.script.attrs.lang
      : undefined;
  const scriptJS = transpileScriptMaybe(sfc.script?.content ?? "", scriptLang);
  const { hoisted, setup } = splitScript(scriptJS);

  // template → IR
  const ir = compileTemplateToIR(sfc.template?.content ?? "", {
    file: sfc.file,
    name: guessName(file),
    scopeAttr,
  });

  // style prelude + setup go before the component code
  const stylePrelude = makeStylePrelude(
    sfc.style?.content ?? "",
    file,
    scoped,
    scopeAttr
  );
  ir.prelude = [stylePrelude, setup].filter(Boolean);

  // finalize
  const { code: componentCode } = generateComponent(ir);
  return { code: [...hoisted, componentCode].join("\n") };
}
