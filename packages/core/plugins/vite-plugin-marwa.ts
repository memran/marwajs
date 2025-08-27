import type { Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

/* -------------------- Options -------------------- */
export type MarwaPluginOptions = {
  entry?: string;                     // default: './App.marwa'
  componentsDirs?: string[];          // default: ['./components']
  strictComponents?: boolean;         // error on missing component instead of warn
};

export default function marwaSfc(opts: MarwaPluginOptions = {}): Plugin {
  const entry = opts.entry ?? './App.marwa';
  const componentsDirs = opts.componentsDirs ?? ['./components'];
  const strictComponents = !!opts.strictComponents;

  return {
    name: 'vite:marwa-sfc',
    enforce: 'pre',

    transform(code, id) {
      // ----- .marwa SFC -----
      if (id.endsWith('.marwa')) {
        const tpl = matchBlock(code, 'template');
        const setup = matchScriptSetup(code);

        /* === validations (build-time) === */
        if (!tpl) this.error(makeFrame('Missing <template> block', code, 1, 1, id));
        if (tpl && strip(tpl).length === 0) this.error(makeFrame('<template> is empty', code, 1, 1, id));
        if (!setup) this.warn(makeFrame('No <script setup> block (ok, but you cannot declare state)', code, 1, 1, id));

        // expand / tag components BEFORE deeper checks
        let normalizedTpl = tagPascalComponents(tpl!);

        // check :for syntax & :key presence (warn)
        validateForSyntax(this, normalizedTpl, code, id);

        // verify PascalCase components exist on disk
        validateComponentsExistence(this, normalizedTpl, id, componentsDirs, strictComponents);

        // proceed with normal transform after validations
        const scriptSetupRaw = setup ?? '';
        const autoImports = `
import * as __Marwa from '@marwajs/core';
const { defineComponent, createApp, provide, inject, ref, reactive, computed, watchEffect, effect, setComponentLoader } = __Marwa;
`;

        // depth-aware auto-return
        const top = topLevelOnly(stripLiterals(scriptSetupRaw));
        const hasExplicitReturn = /^[ \t]*return\s*\{[\s\S]*?\}\s*;?/m.test(top);
        const names = hasExplicitReturn ? [] : collectTopLevelNames(scriptSetupRaw);
        const autoReturn = hasExplicitReturn ? '' : `\nreturn { ...props${names.length ? ', ' + names.join(', ') : ''} };\n`;

        const scriptSetup = `
${scriptSetupRaw.trim()}
${autoReturn}
`;

        const out = `
${autoImports}
export default defineComponent({
  template: ${JSON.stringify(normalizedTpl)},
  setup(props, ctx) {
${scriptSetup.replace(/^/gm, '    ')}
  }
});
`;
        return { code: out, map: null };
      }

      // ----- main.ts/js: loader + autoboot -----
      if (id.endsWith('main.ts') || id.endsWith('main.js')) {
        const hasSfcImport = /\.marwa['"]/.test(code);
        const dir = path.dirname(id);
        const appPath = path.resolve(dir, entry);
        const hasApp = fs.existsSync(appPath);

        const loaderInject = `
import * as __Marwa from '@marwajs/core';
const { setComponentLoader } = __Marwa;
const __mwComponents = import.meta.glob('./components/**/*.marwa');
setComponentLoader(async (name) => {
  for (const [p, loader] of Object.entries(__mwComponents)) {
    if (p.endsWith('/' + name + '.marwa')) {
      return await (loader as any)();
    }
  }
  return undefined;
});
`;

        if (!hasSfcImport && hasApp) {
          return `
${loaderInject}
import { createApp } from '@marwajs/core';
import App from '${entry}';
createApp(App).mount('#app');
`;
        }
        if (!code.includes('setComponentLoader(')) return loaderInject + '\n' + code;
      }
    }
  };
}

/* -------------------- Diagnostics helpers -------------------- */

function strip(s: string) { return s.replace(/\s+/g, ''); }

function matchBlock(src: string, tag: 'template' | 'script'): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = src.match(re);
  return m ? m[1] : null;
}
function matchScriptSetup(src: string): string | null {
  const re = /<script\s+setup(?:\s+lang="ts")?[^>]*>([\s\S]*?)<\/script>/i;
  const m = src.match(re);
  return m ? m[1] : null;
}

/* codeframe with file/loc; Vite understands { message, id, loc } but we include frame too */
function makeFrame(message: string, full: string, line: number, column: number, id: string) {
  return {
    message: `${message}\n` + codeFrame(full, line, column),
    id,
    loc: { file: id, line, column }
  };
}

function codeFrame(src: string, line: number, column: number, context = 2) {
  const lines = src.split(/\r?\n/);
  const start = Math.max(1, line - context);
  const end = Math.min(lines.length, line + context);
  const width = String(end).length;
  let out = '';
  for (let i = start; i <= end; i++) {
    const prefix = (i === line ? '>' : ' ') + ' ' + String(i).padStart(width) + ' | ';
    out += prefix + lines[i - 1] + '\n';
    if (i === line) {
      out += ' '.repeat(prefix.length + column - 1) + '^\n';
    }
  }
  return out;
}

/* locate approximate line/col of a substring in the full file */
function posOf(full: string, snippet: string): { line: number; column: number } {
  const idx = full.indexOf(snippet);
  if (idx < 0) return { line: 1, column: 1 };
  const sub = full.slice(0, idx);
  const lines = sub.split(/\r?\n/);
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column };
}

/* -------------------- Template validations -------------------- */

/** Expand self-closing PascalCase tags and tag them for compiler */
function tagPascalComponents(html: string) {
  // <UserCard /> -> <UserCard data-mw-comp="UserCard"></UserCard>
  html = html.replace(/<([A-Z][A-Za-z0-9_]*)\b([^>]*)\/>/g, (_m, name, rest) => {
    const hasMarker = /\bdata-mw-comp=/.test(rest || '');
    const injected = hasMarker ? rest : ` data-mw-comp="${name}"${rest ? ' ' + rest.trim() : ''}`;
    return `<${name}${injected}></${name}>`;
  });

  // <UserCard ...> -> <UserCard data-mw-comp="UserCard" ...>
  html = html.replace(/<([A-Z][A-Za-z0-9_]*)\b([^>]*)>/g, (_m, name, rest) => {
    if (rest && /\bdata-mw-comp=/.test(rest)) return `<${name}${rest}>`;
    const injected = rest ? ` data-mw-comp="${name}" ${rest.trim()}` : ` data-mw-comp="${name}"`;
    return `<${name}${injected}>`;
  });

  return html;
}

/** Validate :for expressions & :key presence; emit errors/warnings with frames */
function validateForSyntax(ctx: PluginContextLike, tpl: string, full: string, id: string) {
  // find all elements with :for="..."
  const re = /:for\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl))) {
    const expr = m[1];
    const ok = /^\s*(?:\(\s*[\w$]+\s*,\s*[\w$]+\s*\)|[\w$]+)\s+in\s+.+\s*$/.test(expr);
    const { line, column } = posOf(full, m[0]); // approximate
    if (!ok) {
      ctx.error(makeFrame(`Invalid :for expression: ${expr}`, full, line, column, id) as any);
      continue;
    }
    // warn if no :key sibling on same tag
    const before = tpl.lastIndexOf('<', m.index);
    const close = tpl.indexOf('>', m.index);
    const tagSlice = tpl.slice(before, close + 1);
    if (!/:key\s*=/.test(tagSlice)) {
      ctx.warn(makeFrame('Performance: :for without :key (add :key for stable diffing)', full, line, column, id) as any);
    }
  }
}

/** Validate that every PascalCase component has a file in componentsDirs */
function validateComponentsExistence(
  ctx: PluginContextLike,
  tpl: string,
  id: string,
  dirs: string[],
  strict: boolean
) {
  const used = new Set<string>();
  for (const m of tpl.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)) used.add(m[1]);

  if (!used.size) return;

  const fileDir = path.dirname(id);
  const missing: { name: string; where: { line: number; column: number } }[] = [];

  for (const name of used) {
    let found = false;
    for (const dirRel of dirs) {
      const dirAbs = path.resolve(fileDir, dirRel);
      // try Name.marwa anywhere under dirAbs
      // Since full glob is heavy here, we try common locations:
      const direct = path.join(dirAbs, `${name}.marwa`);
      if (fs.existsSync(direct)) { found = true; break; }
      // try nested search one level (cheap)
      if (fs.existsSync(dirAbs)) {
        const sub = fs.readdirSync(dirAbs, { withFileTypes: true });
        for (const d of sub) {
          if (d.isDirectory()) {
            const p = path.join(dirAbs, d.name, `${name}.marwa`);
            if (fs.existsSync(p)) { found = true; break; }
          }
        }
      }
      if (found) break;
    }
    if (!found) {
      const { line, column } = posOf(tpl, `<${name}`);
      missing.push({ name, where: { line, column } });
    }
  }

  if (!missing.length) return;

  const list = missing.map(m => `- <${m.name}> @ line ${m.where.line}`).join('\n');
  const msg = `Component file not found for:\n${list}\nSearched dirs: ${dirs.join(', ')}`;
  if (strict) {
    // map template line to file line roughly by locating <template>
    ctx.error({ message: msg, id });
  } else {
    ctx.warn({ message: msg, id });
  }
}

/* -------------------- Top-level scanners (auto-return) -------------------- */

// strip comments/strings but keep line breaks
function stripLiterals(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, s => s.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, s => s.replace(/[^\n]/g, ' '))
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, s => s.replace(/[^\n]/g, ' '));
}
// keep only depth 0 (brace) content
function topLevelOnly(src: string): string {
  let out = '', depth = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') { depth++; out += ' '; continue; }
    if (ch === '}') { depth = Math.max(0, depth - 1); out += ' '; continue; }
    out += depth === 0 ? ch : (ch === '\n' ? '\n' : ' ');
  }
  return out;
}
function collectTopLevelNames(src: string): string[] {
  const s = topLevelOnly(stripLiterals(src));
  const names = new Set<string>();
  for (const m of s.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[1]);
  for (const m of s.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)\b/g)) names.add(m[1]);
  for (const m of s.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/g)) names.add(m[1]);
  ['props','ctx','defineProps','defineEmits','defineExpose'].forEach(n => names.delete(n));
  return Array.from(names);
}

/* -------------------- Minimal plugin context typing -------------------- */
type PluginContextLike = {
  warn: (e: any) => void;
  error: (e: any) => never;
};
