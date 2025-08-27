// src/vite-plugin-marwa.ts
import type { Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

/* ===========================================================
 * Options
 * =========================================================== */
export type MarwaPluginOptions = {
  entry?: string;               // default: './App.marwa'
  componentsDirs?: string[];    // default: ['./components']
  strictComponents?: boolean;   // error (true) vs warn (false) when a component file is missing
  builtins?: string[];          // PascalCase tags NOT treated as SFCs (runtime/plugin-provided)
};

/* ===========================================================
 * Public plugin
 * =========================================================== */
export default function marwaSfc(opts: MarwaPluginOptions = {}): Plugin {
  const entry = opts.entry ?? './App.marwa';
  const componentsDirs = opts.componentsDirs ?? ['./components'];
  const strictComponents = !!opts.strictComponents;
  const BUILTINS = new Set<string>(['RouterLink', 'RouterView', ...(opts.builtins ?? [])]);

  return {
    name: 'vite:marwa-sfc',
    enforce: 'pre',

    transform(code, id) {
      /* ---------------- .marwa / .pulse SFC ---------------- */
      if (id.endsWith('.marwa') || id.endsWith('.pulse')) {
        let tpl = matchBlock(code, 'template');
        const setup = matchScriptSetup(code);
        const styles = matchAllStyles(code);

        /* ---------- diagnostics ---------- */
        if (!tpl) this.error(makeFrame('Missing <template> block', code, 1, 1, id));
        if (tpl && stripWS(tpl).length === 0) this.error(makeFrame('<template> is empty', code, 1, 1, id));
        if (!setup) this.warn(makeFrame('No <script setup> block (ok, but you cannot declare state)', code, 1, 1, id));

        // Normalize/mark components before further checks
        let normalizedTpl = tagPascalComponents(tpl!, BUILTINS);

        // Validate loops & components
        validateForSyntax(this, normalizedTpl, code, id);
        validateComponentsExistence(this, normalizedTpl, id, componentsDirs, strictComponents, BUILTINS);

        /* ---------- SCOPED STYLES ---------- */
        const scopedParts = styles.filter(s => s.scoped);
        let scopeAttrName = '';
        let scopedCssJoined = '';
        if (scopedParts.length) {
          const scopeId = 's-' + hash(id);
          scopeAttrName = `data-${scopeId}`;
          normalizedTpl = addScopeAttrToHtml(normalizedTpl, ` ${scopeAttrName}`);
          const rawCss = scopedParts.map(s => s.css).join('\n');
          scopedCssJoined = rewriteCssSelectors(rawCss, scopeAttrName);
        }

        /* ---------- <script setup>: hoist user imports ---------- */
        const scriptSetupRaw = setup ?? '';
        const { imports: userImports, body: scriptBodyNoImports } = extractUserImports(scriptSetupRaw);

        /* ---------- auto-imports + auto-return ---------- */
        const autoImports = `
import * as __Marwa from '@marwajs/core';
const {
  defineComponent,
  createApp,
  provide,
  inject,
  ref,
  reactive,
  computed,
  watchEffect,
  effect,
  setComponentLoader,
  defineStore,
  getStore,
  storeRegistry
} = __Marwa;
`.trim();

        const top = topLevelOnly(stripLiterals(scriptBodyNoImports));
        const hasExplicitReturn = /^[ \t]*return\s*\{[\s\S]*?\}\s*;?/m.test(top);
        const names = hasExplicitReturn ? [] : collectTopLevelNames(scriptBodyNoImports);
        const autoReturn = hasExplicitReturn ? '' : `\nreturn { ...props${names.length ? ', ' + names.join(', ') : ''} };\n`;

        const scriptSetup = `
${(scriptBodyNoImports || '').trim()}
${autoReturn}
`.trim();

        /* ---------- runtime CSS injector (once per file) ---------- */
        const cssHash = hash(id);
        const cssInject = scopedCssJoined
          ? `
const __mw_css_${cssHash} = ${JSON.stringify(scopedCssJoined)};
function __mw_inject_style_once(id, css) {
  const sid = 'mw-style-' + id;
  if (document.getElementById(sid)) return;
  const el = document.createElement('style');
  el.id = sid;
  el.setAttribute('type', 'text/css');
  el.appendChild(document.createTextNode(css));
  document.head.appendChild(el);
}
`.trim()
          : '';

        const cssCall = scopedCssJoined ? `__mw_inject_style_once(${JSON.stringify(cssHash)}, __mw_css_${cssHash});` : '';

        /* ---------- final module ---------- */
        const out = `
${userImports}
${autoImports}
${cssInject}

export default defineComponent({
  template: ${JSON.stringify(normalizedTpl)},
  setup(props, ctx) {
    ${cssCall}
${indent(scriptSetup, 4)}
  }
});
`.trim();

        return { code: out, map: null };
      }

      /* ---------------- main.ts|js: loader + autoboot ---------------- */
      if (id.endsWith('main.ts') || id.endsWith('main.js')) {
        const hasSfcImport = /\.marwa['"]|\.pulse['"]/.test(code);
        const dir = path.dirname(id);
        const appPath = path.resolve(dir, entry);
        const hasApp = fs.existsSync(appPath);

        // IMPORTANT: return the actual component, not the module object
        const loaderInject = `
import * as __Marwa from '@marwajs/core';
const { setComponentLoader } = __Marwa;
const __mwComponents = import.meta.glob('./components/**/*.marwa');
const __mwComponentsPulse = import.meta.glob('./components/**/*.pulse');
setComponentLoader(async (name) => {
  for (const [p, loader] of Object.entries({ ...__mwComponents, ...__mwComponentsPulse })) {
    if (p.endsWith('/' + name + '.marwa') || p.endsWith('/' + name + '.pulse')) {
      const mod = await (loader as any)();
      return (mod && (mod.default ?? mod)); // <<< critical: unwrap default
    }
  }
  return undefined;
});
`.trim();

        if (!hasSfcImport && hasApp) {
          return `
${loaderInject}
import { createApp } from '@marwajs/core';
import App from '${entry}';
createApp(App).mount('#app');
`.trim();
        }
        if (!code.includes('setComponentLoader(')) {
          return loaderInject + '\n' + code;
        }
      }
    }
  };
}

/* ===========================================================
 * Diagnostics helpers
 * =========================================================== */
function stripWS(s: string) { return s.replace(/\s+/g, ''); }

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

function posOf(full: string, snippet: string): { line: number; column: number } {
  const idx = full.indexOf(snippet);
  if (idx < 0) return { line: 1, column: 1 };
  const sub = full.slice(0, idx);
  const lines = sub.split(/\r?\n/);
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column };
}

/* ===========================================================
 * Template transforms + validations
 * =========================================================== */

// Expand self-closing PascalCase tags and tag component usage,
// BUT skip built-ins like RouterLink/RouterView (plugin-provided).
function tagPascalComponents(html: string, builtins: Set<string>) {
  // <UserCard /> -> <UserCard data-mw-comp="UserCard"></UserCard> (unless builtin)
  html = html.replace(/<([A-Z][A-Za-z0-9_]*)\b([^>]*)\/>/g, (_m, name, rest) => {
    if (builtins.has(name)) {
      return `<${name}${rest ? ' ' + rest.trim() : ''}></${name}>`;
    }
    const hasMarker = /\bdata-mw-comp=/.test(rest || '');
    const injected = hasMarker ? rest : ` data-mw-comp="${name}"${rest ? ' ' + rest.trim() : ''}`;
    return `<${name}${injected}></${name}>`;
  });

  // <UserCard ...> -> <UserCard data-mw-comp="UserCard" ...> (unless builtin)
  html = html.replace(/<([A-Z][A-Za-z0-9_]*)\b([^>]*)>/g, (_m, name, rest) => {
    if (builtins.has(name)) {
      return `<${name}${rest ?? ''}>`; // no data-mw-comp for builtins
    }
    if (rest && /\bdata-mw-comp=/.test(rest)) return `<${name}${rest}>`;
    const injected = rest ? ` data-mw-comp="${name}" ${rest.trim()}` : ` data-mw-comp="${name}"`;
    return `<${name}${injected}>`;
  });

  return html;
}

/** Validate :for expressions & :key presence; emit errors/warnings */
function validateForSyntax(ctx: PluginContextLike, tpl: string, full: string, id: string) {
  const re = /:for\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl))) {
    const expr = m[1];
    const ok = /^\s*(?:\(\s*[\w$]+\s*,\s*[\w$]+\s*\)|[\w$]+)\s+in\s+.+\s*$/.test(expr);
    const { line, column } = posOf(full, m[0]);
    if (!ok) {
      ctx.error(makeFrame(`Invalid :for expression: ${expr}`, full, line, column, id) as any);
      continue;
    }
    // warn when no :key on same tag
    const openIdx = tpl.lastIndexOf('<', m.index);
    const closeIdx = tpl.indexOf('>', m.index);
    const slice = tpl.slice(openIdx, closeIdx + 1);
    if (!/:key\s*=/.test(slice)) {
      ctx.warn(makeFrame('Performance: :for without :key (add :key for stable diffing)', full, line, column, id) as any);
    }
  }
}

/** Validate PascalCase components exist under componentsDirs — skip builtins */
function validateComponentsExistence(
  ctx: PluginContextLike,
  tpl: string,
  id: string,
  dirs: string[],
  strict: boolean,
  builtins: Set<string>
) {
  const used = new Set<string>();
  for (const m of tpl.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)) used.add(m[1]);
  if (!used.size) return;

  const fileDir = path.dirname(id);
  const missing: { name: string; where: { line: number; column: number } }[] = [];

  for (const name of used) {
    if (builtins.has(name)) continue;
    let found = false;
    for (const dirRel of dirs) {
      const dirAbs = path.resolve(fileDir, dirRel);
      const p1 = path.join(dirAbs, `${name}.marwa`);
      const p2 = path.join(dirAbs, `${name}.pulse`);
      if (fs.existsSync(p1) || fs.existsSync(p2)) { found = true; break; }
      if (fs.existsSync(dirAbs)) {
        for (const d of fs.readdirSync(dirAbs, { withFileTypes: true })) {
          if (!d.isDirectory()) continue;
          const c1 = path.join(dirAbs, d.name, `${name}.marwa`);
          const c2 = path.join(dirAbs, d.name, `${name}.pulse`);
          if (fs.existsSync(c1) || fs.existsSync(c2)) { found = true; break; }
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
  if (strict) ctx.error({ message: msg, id } as any);
  else ctx.warn({ message: msg, id } as any);
}

/* ===========================================================
 * Scoped styles
 * =========================================================== */

// djb2 hash → short hex
function hash(str: string) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

// Extract all <style> blocks
function matchAllStyles(src: string) {
  const re = /<style([^>]*)>([\s\S]*?)<\/style>/gi;
  const out: { attrs: string; css: string; scoped: boolean }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const attrs = m[1] || '';
    out.push({
      attrs,
      css: m[2] || '',
      scoped: /\bscoped\b/i.test(attrs)
    });
  }
  return out;
}

// Add scope attr to every opening element tag (skip script/style)
function addScopeAttrToHtml(html: string, attrName: string) {
  return html.replace(
    /<([A-Za-z][^\s/>]*)\b([^>]*)>/g,
    (full, tag, rest) => {
      const lower = String(tag).toLowerCase();
      if (lower === 'script' || lower === 'style') return full;
      if (full.includes(attrName)) return full;
      const space = rest && String(rest).trim().length ? ' ' : '';
      return `<${tag}${rest}${space}${attrName}>`;
    }
  );
}

// Append [attr] to last simple selector in a selector
function scopeOneSelector(sel: string, attrSel: string) {
  sel = sel.replace(/:global\(([^)]+)\)/g, '$1');
  const s = sel.trim();
  if (!s || s.startsWith('@')) return s;
  if (/^(from|to|\d+%)\s*$/.test(s)) return s;
  const lastPseudo = s.lastIndexOf(':');
  if (lastPseudo > -1) {
    return s.slice(0, lastPseudo) + attrSel + s.slice(lastPseudo);
  }
  return s + attrSel;
}

// Lightweight CSS rewriter for component-level CSS
function rewriteCssSelectors(css: string, attrName: string) {
  const attrSel = `[${attrName}]`;
  css = css.replace(/:global\(([^)]+)\)/g, (_, inner) => inner);
  const processLine = (line: string) => {
    if (/^\s*(from|to|\d+%)/.test(line)) return line;
    return line.replace(/(^|,)([^,{]+)(?=\s*\{)/g, (_m, lead, sel) => {
      const scoped = scopeOneSelector(sel, attrSel);
      return `${lead}${scoped}`;
    });
  };
  return css
    .split('\n')
    .map(ln => (ln.includes('{') ? processLine(ln) : ln))
    .join('\n');
}

/* ===========================================================
 * <script setup> helpers
 * =========================================================== */

// strip comments & strings (keep line breaks)
function stripLiterals(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, s => s.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, s => s.replace(/[^\n]/g, ' '))
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, s => s.replace(/[^\n]/g, ' '));
}
// keep only depth 0 content
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

// Hoist top-level imports from <script setup> to module top
function extractUserImports(script: string) {
  const importRE = /^[ \t]*import(?:[\s\S]*?from\s*['"][^'"]+['"]|[\s\S]*?['"][^'"]+['"])\s*;?/mg;
  const imports: string[] = [];
  let body = script;
  let m: RegExpExecArray | null;
  while ((m = importRE.exec(script))) imports.push(m[0]);
  if (imports.length) body = script.replace(importRE, '').trim();
  return { imports: imports.join('\n'), body };
}

/* ===========================================================
 * Utils
 * =========================================================== */
function indent(s: string, n: number) {
  const pad = ' '.repeat(n);
  return s.split('\n').map(l => (l ? pad + l : l)).join('\n');
}

/* Minimal plugin context typing for diagnostics helpers */
type PluginContextLike = {
  warn: (e: any) => void;
  error: (e: any) => never;
};
