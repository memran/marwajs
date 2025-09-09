// MarwaJS SFC transformer (corrected)
// - Splits <template>/<script>/<style>
// - Hoists code before `export const page = …` and the page stmt itself
// - Puts the rest of <script> into setup()
// - Auto-imports core helpers used in script/template (ref/computed/etc)
// - Imports ONE consolidated runtime line including directives/effect/mount and built-ins
// - Auto-imports user components (PascalCase) via resolveComponent()
// - Supports pipes in {{ }} via applyPipe()
// - Supports m-model / m-model:prop two-way binding
// - Emits tiny render/mount functions; zero runtime parsing

import MagicString from 'magic-string';
import { transform as sucrase } from 'sucrase';
import * as acorn from 'acorn';

import { parseSFC } from './sfc.js';
import { scopeCss, scopeId } from './style.js';
import { rewriteExpr } from './expr.js';

/* ---------------- constants ---------------- */

const INTERP_NODE_ATTR = 'data-mw-t';
const NODE_KEY_ATTR    = 'data-mw';

// helpers auto-imported when used in code/template
const CORE_AUTO_IMPORTS = new Set([
  'ref','computed','effect','onMount','onCleanup',
  'createStore','provide','use',
  'Security','Analyzer','Optimizer','registerPipe',
  'definePage'
]);

// Built-ins are imported once via the BASE_RUNTIME_IMPORTS (see below)
// (we do NOT add them to auto imports to avoid duplicate identifiers)
const BUILTIN_COMPONENTS = new Set(['RouterLink','RouterView']);

// Runtime/API we ALWAYS import once (unified line)
const BASE_RUNTIME_IMPORTS = [
  'defineComponent','runMount','runCleanup',
  'dText','dHtml','dShow','dModel','dClass','dStyle',
  'applyPipe','mount','effect',
  'RouterLink','RouterView',
];

const HTML_TAGS = new Set([
  'div','span','p','a','ul','li','ol','button','input','select','option','textarea',
  'label','form','img','section','article','header','footer','nav','main',
  'h1','h2','h3','h4','h5','h6','table','thead','tbody','tr','td','th',
  'template','slot','canvas','svg','path','g','br','hr','meta','link','source','track','wbr','col','base','embed','param','area'
]);
const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

/* ---------------- public API ---------------- */

export type CompileOptions = {
  file: string;
  directivePrefix?: string;                // default ':'
  resolveComponent?: (name: string, fromFile: string)=>string|undefined;
  componentLoad?: 'eager'|'lazy';          // default 'eager'
  prod?: boolean;
};

export function compileSFC(code: string, opts: CompileOptions) {
  const sfc = parseSFC(code);
  const scope = scopeId(opts.file);
  const styles = scopeCss(sfc.style, scope);

  const resolveComponent = opts.resolveComponent ?? ((n) => `@/components/${n}.marwa`);
  const componentLoad = opts.componentLoad ?? 'eager';
  const dir = opts.directivePrefix ?? ':';

  /* -------- template -------- */
  const tpl = compileTemplate(sfc.template, {
    scope, dir, resolveComponent, componentLoad, fromFile: opts.file
  });

  /* -------- script -------- */
  const out = new MagicString('');
  out.append(`/* file: ${opts.file} */\n`);
  out.append(`const __scopeId = ${JSON.stringify(scope)};\n`);
  out.append(`const __styles = ${JSON.stringify(styles)};\n`);
  out.append(`const __U=(v)=>v&&typeof v==='object'&&'value'in v?v.value:v;\n`);
  out.append(`const __UD=(v)=>{while(v&&typeof v==='object'&&'value'in v)v=v.value;return v};\n`);

  const scriptTS = sfc.script || 'export {}';

  // Gather & preserve user imports
  const importLines = scriptTS.match(/^\s*import[\s\S]+?;$/gm) || [];
  let bodyTS = scriptTS.replace(/^\s*import[\s\S]+?;$/gm, '');

  // Hoist everything before `export const page` AND the page stmt itself
  const { prefixTS, pageTS, restTS } = extractHoistedPage(bodyTS);
  let hoistedPrefixTS = stripExports(prefixTS);
  let hoistedPageTS   = pageTS;              // keep export here
  bodyTS = stripExports(restTS);

  // TS→JS (if needed)
  const looksTS = /:\s*[A-Za-z_][\w<>\[\]\|&\.\s?,:]*\)?\s*=>|interface\s|type\s|enum\s/.test(scriptTS) || /lang\s*=\s*["']ts["']/.test(sfc.script || '');
  const prefixJS = looksTS ? trySucrase(hoistedPrefixTS) : hoistedPrefixTS;
  const pageJS   = looksTS ? trySucrase(hoistedPageTS)   : hoistedPageTS;
  const bodyJS   = looksTS ? trySucrase(bodyTS)          : bodyTS;

  // Auto-import core helpers used across script + template render body
  const alreadyImportedFromCore = new Set<string>();
  for (const line of importLines) {
    if (/from\s+['"]@marwajs\/core['"]/.test(line)) {
      const m = line.match(/\{([^}]+)\}/);
      if (m) m[1].split(',').forEach(t => {
        const n = t.trim().split(/\s+as\s+/)[0].trim();
        if (n) alreadyImportedFromCore.add(n);
      });
    }
  }

  const declared = collectTopLevelDecls(prefixJS + '\n' + pageJS + '\n' + bodyJS);
  const usedCore = new Set<string>();
  for (const sym of CORE_AUTO_IMPORTS) {
    if (
      new RegExp(`\\b${sym}\\b`).test(prefixJS) ||
      new RegExp(`\\b${sym}\\b`).test(pageJS) ||
      new RegExp(`\\b${sym}\\b`).test(bodyJS) ||
      new RegExp(`\\b${sym}\\b`).test(tpl.body) // include template render usage (e.g., effect)
    ) {
      usedCore.add(sym);
    }
  }
  // names we need in addition to BASE_RUNTIME_IMPORTS
  const missingCore = [...usedCore].filter(n => !alreadyImportedFromCore.has(n) && !declared.has(n));

  /* ---------- emit imports ---------- */

  // 1) user imports verbatim
  out.append(`// user imports\n`);
  importLines.forEach(l => out.append(l + '\n'));

  // 2) unified runtime + helpers (single line, no duplicates)
  const allImports = Array.from(new Set([...BASE_RUNTIME_IMPORTS, ...missingCore]));
  out.append(`import { ${allImports.join(', ')} } from '@marwajs/core';\n`);

  // 3) auto-imported user components discovered in template (eager or lazy path resolves later)
  if (tpl.autoImports.length) {
    out.append(`// auto-imported components (eager)\n`);
    for (const { name, path } of tpl.autoImports) out.append(`import ${name} from '${path}';\n`);
  }

  /* ---------- hoisted & setup ---------- */

  if (prefixJS.trim()) out.append(`\n// hoisted prefix\n${prefixJS}\n`);
  if (pageJS.trim())   out.append(`\n// hoisted page\n${pageJS}\n`);

  out.append(`\n// user script (setup scope)\n`);
  out.append(`let __setup = (props, emit) => {\n${bodyJS}\n`);
  const exportNames = extractExports(bodyJS);
  const declNames = Array.from(declared);
  const bindings = Array.from(new Set([...exportNames, ...declNames]));
  out.append(`return { props, emit, ...Object.fromEntries(Object.entries({${
    bindings.map(n => `${n}: (typeof ${n}==='undefined'?undefined:${n})`).join(',')
  }}).filter(([,v])=>v!==undefined)) };\n};\n`);

  /* ---------- render ---------- */

  out.append(`\n// render\n`);
  out.append(`const __render = (root, ctx) => { root.setAttribute('data-'+__scopeId,'');\n`);
  out.append(tpl.body);
  out.append(`\nreturn () => { ${tpl.cleanups.join(';')} };\n};\n`);

  /* ---------- component export ---------- */

  out.append(`\nexport default defineComponent({ name: ${JSON.stringify(basename(opts.file))}, scopeId: __scopeId, styles: __styles, setup: __setup, render: __render });\n`);
  out.append(`export function __mount(target){ const inst = __setup({}, ()=>{}); runMount(inst); const c = __render(target, inst); return ()=>{ if (typeof c==='function') c(); runCleanup(inst); }; }\n`);

  return { code: out.toString(), map: null };
}

/* ---------------- template compiler ---------------- */

function compileTemplate(
  tpl: string,
  { scope, dir, resolveComponent, componentLoad, fromFile }:
  { scope: string; dir: string; resolveComponent: (n:string,f:string)=>string|undefined; componentLoad: 'eager'|'lazy'; fromFile: string }
) {
  let html = (tpl || '').trim().replace(/\s+/g, ' ');
  html = expandSelfClosing(html);

  // discover components / built-ins
  const componentNames = new Set<string>();
  html.replace(/<([A-Za-z][A-Za-z0-9_-]*)\b/g, (_m, tag: string) => {
    const isNative = HTML_TAGS.has(tag.toLowerCase());
    if (/^[A-Z]/.test(tag) && !isNative) {
      if (!BUILTIN_COMPONENTS.has(tag)) componentNames.add(tag);
    }
    return '';
  });

  // Interpolations with pipes
  type Interp = { idx: number; expr: string };
  const textInterps: Interp[] = [];
  let textIndex = 0;
  const htmlWithSpans = html.replace(/\{\{\s*([^{}]+(?:\{[^{}]*\}[^{}]*)*)\s*\}\}/g, (_m, exp) => {
    try {
      const compiled = compileInterpolationWithPipes(String(exp).trim());
      const rewritten = rewriteExpr(compiled, ['applyPipe']);
      const idx = textIndex++;
      textInterps.push({ idx, expr: rewritten });
      return `<span ${INTERP_NODE_ATTR}="${idx}"></span>`;
    } catch {
      return _m;
    }
  });

  // Stamp nodes, keep original attrs for later cleanup
  let nodeKey = 0;
  const openTagRegex = /<([A-Za-z0-9-]+)((?:\s+[^>]*?)?)>/g;
  const nodes: Array<{ key: string; tag: string; attrs: string; cleanAttrs: string }> = [];
  const stamped = htmlWithSpans.replace(openTagRegex, (_m, tag: string, attrs: string) => {
    const key = String(nodeKey++);
    nodes.push({ key, tag, attrs, cleanAttrs: cleanFrameworkAttrs(attrs) });
    return `<${tag}${attrs} ${NODE_KEY_ATTR}="${key}">`;
  });

  // Replace with cleaned attrs
  const elementScan = /<([A-Za-z0-9-]+)((?:\s+[^>]*?)?)\s+data-mw="(\d+)"[^>]*>/g;
  const cleanedHTML = stamped.replace(elementScan, (_m, tag: string, attrs: string, key: string) => {
    const rec = nodes[Number(key)];
    return `<${tag}${rec?.cleanAttrs ?? attrs} ${NODE_KEY_ATTR}="${key}">`;
  });

  const body: string[] = [];
  const cleanups: string[] = [];
  body.push(`root.innerHTML = ${JSON.stringify(cleanedHTML)};`);

  // text interpolation effects
  for (const it of textInterps) {
    body.push(`{ const el = root.querySelector('[${INTERP_NODE_ATTR}="${it.idx}"]'); if (el) effect(()=>{ try{ el.textContent = String(__UD(${it.expr})); }catch(e){ console.warn('interp', e); } }); }`);
  }

  // Iterate nodes for directives/events/components
  let m: RegExpExecArray | null;
  elementScan.lastIndex = 0;
  while ((m = elementScan.exec(stamped))) {
    const tag = m[1];
    const node = nodes[Number(m[3])];
    const attrs = node?.attrs ?? '';
    const elSel = `root.querySelector('[${NODE_KEY_ATTR}="${m[3]}"]')`;

    const isBuiltin = BUILTIN_COMPONENTS.has(tag);
    const isComponent = /^[A-Z]/.test(tag) && !HTML_TAGS.has(tag.toLowerCase());

    if (isBuiltin) {
      const propsCode = buildComponentProps(attrs);
      // capture label/content BEFORE replacing the node
      body.push(`{
        const el=${elSel};
        if (el) {
          const _children = el.textContent || '';
          const ph=document.createElement('div');
          el.replaceWith(ph);
          const _props = Object.assign(${propsCode}, { children: _children });
          mount(${tag}, ph, _props);
        }
      }`);
      continue;
    }

    if (isComponent) {
      const propsCode = buildComponentProps(attrs);
      const p = resolveComponent(tag, fromFile);
      if (p) {
        if (componentLoad === 'eager') {
          body.push(`{
            const el=${elSel};
            if (el) {
              const _children = el.textContent || '';
              const ph=document.createElement('div');
              el.replaceWith(ph);
              const _props = Object.assign(${propsCode}, { children: _children });
              mount(${tag}, ph, _props);
            }
          }`);
        } else {
          body.push(`{
            const el=${elSel};
            if (el) {
              const _children = el.textContent || '';
              const ph=document.createElement('div');
              el.replaceWith(ph);
              const _props = Object.assign(${propsCode}, { children: _children });
              import('${p}').then(m => { mount(m.default, ph, _props); });
            }
          }`);
        }
      } else {
        body.push(`{ const el=${elSel}; if(el) console.warn('Marwa: component not found for ${tag}'); }`);
      }
      continue;
    }

    // directives (prefixed)
    const directiveRegex = new RegExp(`${escapeReg(dir)}([a-zA-Z-]+)\\s*=\\s*"([^"]+)"`, 'g');
    let dm: RegExpExecArray | null;
    directiveRegex.lastIndex = 0;
    while ((dm = directiveRegex.exec(attrs))) {
      const name = dm[1];
      const expr = dm[2];
      const valueExpr = rewriteExpr(expr, ['el']);
      body.push(`{ const el=${elSel}; if(el){ (${dirImpl(name)})(${valueExpr}, { el, ctx, emit: ctx.emit }); } }`);
    }

    // events
    const eventRx = /@([A-Za-z][\w:-]*)\s*=\s*"([^"]+)"/g;
    let ev: RegExpExecArray | null;
    eventRx.lastIndex = 0;
    while ((ev = eventRx.exec(attrs))) {
      const evt = ev[1];
      const handler = ev[2];
      if (evt.startsWith('update:')) continue;
      const call = compileEventHandler(handler, ['e']);
      body.push(`{ const el=${elSel}; if(el){ const _h=(e)=>{ try{ ${call}; }catch(err){ console.error('marwa event', err); } }; el.addEventListener('${evt}', _h); } }`);
    }
  }

  // auto-imports for user components
  const autoImports: Array<{ name: string; path: string }> = [];
  for (const name of componentNames) {
    const p = resolveComponent(name, fromFile);
    if (p) autoImports.push({ name, path: p });
  }

  // built-ins imported via BASE_RUNTIME_IMPORTS, so no need to return them
  return { body: body.join('\n'), cleanups, autoImports, autoBuiltins: [] as string[] };
}

/* ---------------- interpolation pipes ---------------- */

function compileInterpolationWithPipes(expression: string): string {
  const parts: string[] = [];
  let cur = '', inQuotes = false, quote: string | null = null, paren = 0, brace = 0;
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
    if (!inQuotes && (ch === '"' || ch === "'")) { inQuotes = true; quote = ch; cur += ch; continue; }
    if (inQuotes) { cur += ch; if (ch === quote) { inQuotes = false; quote = null; } continue; }
    if (ch === '(') paren++; else if (ch === ')') paren = Math.max(0, paren-1);
    else if (ch === '{') brace++; else if (ch === '}') brace = Math.max(0, brace-1);
    if (ch === '|' && paren===0 && brace===0) { parts.push(cur.trim()); cur=''; continue; }
    cur += ch;
  }
  if (cur) parts.push(cur.trim());
  if (parts.length <= 1) return parts[0] || '';
  let acc = parts[0];
  for (let i=1;i<parts.length;i++){
    const seg = parts[i];
    const k = seg.indexOf(':');
    if (k === -1) acc = `applyPipe('${seg.trim()}', ${acc})`;
    else {
      const name = seg.slice(0,k).trim();
      const argsStr = seg.slice(k+1).trim();
      const args = parsePipeArgs(argsStr);
      acc = `applyPipe('${name}', ${acc}${args.length ? ', ' + args.join(', ') : ''})`;
    }
  }
  return acc;
}

function parsePipeArgs(argsString: string): string[] {
  const out: string[] = [];
  let cur = '', inQuotes = false, quote: string | null = null, paren = 0, brace = 0;
  for (let i = 0; i < argsString.length; i++) {
    const ch = argsString[i];
    if (!inQuotes && (ch === '"' || ch === "'")) { inQuotes = true; quote = ch; cur += ch; continue; }
    if (inQuotes) { cur += ch; if (ch === quote) { inQuotes = false; quote = null; } continue; }
    if (ch === '(') paren++; else if (ch === ')') paren = Math.max(0, paren-1);
    else if (ch === '{') brace++; else if (ch === '}') brace = Math.max(0, brace-1);
    if (ch === ',' && paren===0 && brace===0) { if (cur.trim()) out.push(cur.trim()); cur=''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* ---------------- utils ---------------- */

function extractHoistedPage(code: string){
  const idx = code.indexOf('export const page');
  if (idx === -1) return { prefixTS: '', pageTS: '', restTS: code };

  // scan until end of that top-level statement
  let i = idx;
  let brace=0, paren=0, bracket=0;
  let inQuotes=false, quote: string | null = null;
  while (i < code.length) {
    const ch = code[i++];
    if (!inQuotes && (ch === '"' || ch === "'")) { inQuotes = true; quote = ch; continue; }
    if (inQuotes) { if (ch === quote) { inQuotes = false; quote = null; } continue; }
    if (ch === '{') brace++; else if (ch === '}') brace = Math.max(0, brace-1);
    else if (ch === '(') paren++; else if (ch === ')') paren = Math.max(0, paren-1);
    else if (ch === '[') bracket++; else if (ch === ']') bracket = Math.max(0, bracket-1);
    if (ch === ';' && brace===0 && paren===0 && bracket===0) break;
  }
  const prefixTS = code.slice(0, idx);
  const pageTS   = code.slice(idx, i);
  const restTS   = code.slice(i);
  return { prefixTS, pageTS, restTS };
}

function trySucrase(ts: string){ try { return sucrase(ts, { transforms: ['typescript'] }).code; } catch { return ts; } }

function cleanFrameworkAttrs(attrs: string): string {
  const dq = `"[^"\\\\]*(?:\\\\.[^"\\\\]*)*"`;
  const sq = `'[^'\\\\]*(?:\\\\.[^'\\\\]*)*'`;
  const qv = `(?:${dq}|${sq})`;
  let out = attrs
    .replace(new RegExp(`\\s:([A-Za-z_][\\w-]*)\\.sync\\s*=\\s*${qv}`, 'g'), '')
    .replace(new RegExp(`\\s:([A-Za-z_][\\w-]*)\\s*=\\s*${qv}`, 'g'), '')
    .replace(new RegExp(`\\s@([A-Za-z][\\w:-]*)\\s*=\\s*${qv}`, 'g'), '')
    .replace(new RegExp(`\\sm-model(?::[A-Za-z_][\\w-]*|-?[A-Za-z_][\\w-]*)?\\s*=\\s*${qv}`, 'g'), '');
  return out.replace(/\s{2,}/g, ' ');
}

function expandSelfClosing(html: string): string {
  return html.replace(/<([A-Za-z][\w-]*)([^>]*?)\/>/g, (_m, tag: string, attrs: string) => {
    if (VOID_TAGS.has(tag.toLowerCase())) return `<${tag}${attrs}/>`;
    return `<${tag}${attrs}></${tag}>`;
  });
}

function kebabToCamel(s: string) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

function dirImpl(name: string) {
  switch (name) {
    case 'text': return 'dText';
    case 'html': return 'dHtml';
    case 'show': return 'dShow';
    case 'model': return 'dModel';
    case 'class': return 'dClass';
    case 'style': return 'dStyle';
    default: return 'dText';
  }
}

function compileEventHandler(handler: string, locals: string[]): string {
  const src = handler.trim();
  if (/^[A-Za-z_$][\w$]*\s*=>|^\(\s*[^)]*\)\s*=>/.test(src)) {
    const rewritten = rewriteExpr(src, []);
    return `(${rewritten})(e)`;
  }
  if (/^[A-Za-z_$][\w$]*$/.test(src)) {
    return `ctx.${src}(e)`;
  }
  return rewriteExpr(src, ['e', ...locals]);
}

function buildComponentProps(attrs: string): string {
  const entries: string[] = [];

  // m-model
  { let m: RegExpExecArray | null; const rx = /\sm-model\s*=\s*"([^"]+)"/g;
    while ((m = rx.exec(attrs))) {
      const expr = m[1];
      entries.push(`"model": (${rewriteExpr(expr)})`);
      entries.push(`"onUpdate:model": (v)=>{ ${modelSetter(expr)} }`);
    } }

  // m-model:prop
  { let m: RegExpExecArray | null; const rx = /\sm-model:([A-Za-z_][\w-]*)\s*=\s*"([^"]+)"/g;
    while ((m = rx.exec(attrs))) {
      const prop = kebabToCamel(m[1]); const expr = m[2];
      entries.push(`${JSON.stringify(prop)}: (${rewriteExpr(expr)})`);
      entries.push(`${JSON.stringify(`onUpdate:${prop}`)}: (v)=>{ ${modelSetter(expr)} }`);
    } }

  // m-model-prop (alt)
  { let m: RegExpExecArray | null; const rx = /\sm-model-([A-Za-z_][\w-]*)\s*=\s*"([^"]+)"/g;
    while ((m = rx.exec(attrs))) {
      const prop = kebabToCamel(m[1]); const expr = m[2];
      entries.push(`${JSON.stringify(prop)}: (${rewriteExpr(expr)})`);
      entries.push(`${JSON.stringify(`onUpdate:${prop}`)}: (v)=>{ ${modelSetter(expr)} }`);
    } }

  // static props
  { let m: RegExpExecArray | null; const rx = /\s(?!!@|:)([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g;
    while ((m = rx.exec(attrs))) {
      const raw = m[1]; const val = JSON.stringify(m[2]); const key = kebabToCamel(raw);
      entries.push(`${JSON.stringify(key)}: ${val}`);
    } }

  // :prop
  { let m: RegExpExecArray | null; const rx = /\s:([A-Za-z_][\w-]*)\s*=\s*"([^"]+)"/g;
    while ((m = rx.exec(attrs))) {
      const key = kebabToCamel(m[1]); const expr = m[2];
      if (entries.some(e => e.startsWith(`${JSON.stringify(key)}:`))) continue;
      if (key === 'model' || key === 'modelValue') {
        const rewritten = rewriteExpr(expr);
        entries.push(`${JSON.stringify(key)}: (${rewritten})`);
        const setter = modelSetter(expr);
        entries.push(`${JSON.stringify(key==='model'?'onUpdate:model':'onUpdate:modelValue')}: (v)=>{ ${setter} }`);
      } else {
        entries.push(`${JSON.stringify(key)}: (${rewriteExpr(expr)})`);
      }
    } }

  // events (including update:prop)
  { let m: RegExpExecArray | null; const rx = /@([A-Za-z][\w:-]*)\s*=\s*"([^"]+)"/g;
    while ((m = rx.exec(attrs))) {
      const rawEvt = m[1]; const handler = m[2];
      const onKey = rawEvt.startsWith('update:')
        ? `onUpdate:${kebabToCamel(rawEvt.slice('update:'.length))}`
        : 'on' + kebabToCamel(rawEvt.charAt(0).toUpperCase() + rawEvt.slice(1));
      const call = compileEventHandler(handler, ['e']);
      entries.push(`${JSON.stringify(onKey)}: (e)=>{ try{ ${call}; }catch(err){ console.error('marwa event', err); } }`);
    } }

  return `{ ${entries.join(', ')} }`;
}

function modelSetter(expr: string): string {
  const e = expr.trim();
  if (/\.value\s*$/.test(e)) {
    const target = rewriteExpr(e);
    return `${target} = v;`;
  }
  const rewritten = rewriteExpr(e);
  return `(function(_x){ if (_x && typeof _x==='object' && 'value' in _x) _x.value = v; else { ${rewritten} = v; } })(${rewritten})`;
}

function extractExports(scriptBody: string) {
  const names = Array.from(scriptBody.matchAll(/export\s+(?:const|let|function|class)\s+([A-Za-z0-9_]+)/g)).map(m => m[1]);
  const braced = Array.from(scriptBody.matchAll(/export\s*\{([^}]+)\}/g))
    .flatMap(m => m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()));
  return Array.from(new Set([...names, ...braced]));
}

function basename(p: string) {
  return p.split(/[\\/]/).pop()?.replace(/\.marwa$/, '') ?? 'Component';
}

function stripExports(code: string): string {
  return code
    .replace(/^\s*export\s+(?=(const|let|var|function|class)\b)/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
}

function collectTopLevelDecls(code: string): Set<string> {
  const ids = new Set<string>();
  let ast: any;
  try { ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' }); } catch { return ids; }
  for (const node of ast.body) {
    switch (node.type) {
      case 'VariableDeclaration':
        for (const d of node.declarations) collectPatternIdsLite(d.id, ids);
        break;
      case 'FunctionDeclaration':
        if (node.id) ids.add(node.id.name);
        break;
      case 'ClassDeclaration':
        if (node.id) ids.add(node.id.name);
        break;
    }
  }
  return ids;
}

function collectPatternIdsLite(pat: any, out: Set<string>) {
  if (!pat) return;
  if (pat.type === 'Identifier') out.add(pat.name);
  else if (pat.type === 'ObjectPattern') for (const prop of pat.properties ?? []) {
    if (prop.type === 'Property') collectPatternIdsLite(prop.value, out);
    else if (prop.type === 'RestElement') collectPatternIdsLite(prop.argument, out);
  }
  else if (pat.type === 'ArrayPattern') for (const el of pat.elements ?? []) el && collectPatternIdsLite(el, out);
  else if (pat.type === 'AssignmentPattern') collectPatternIdsLite(pat.left, out);
  else if (pat.type === 'RestElement') collectPatternIdsLite(pat.argument, out);
}

function escapeReg(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
