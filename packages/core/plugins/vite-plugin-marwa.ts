import type { Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

// --- utils -------------------------------------------------------------

// Expand self-closing PascalCase tags and tag component usage
function tagPascalComponents(html: string) {
  // 1) <UserCard />  -> <UserCard data-mw-comp="UserCard"></UserCard>
  html = html.replace(/<([A-Z][A-Za-z0-9_]*)\b([^>]*)\/>/g, (_m, name, rest) => {
    const hasMarker = /\bdata-mw-comp=/.test(rest || '');
    const injected = hasMarker ? rest : ` data-mw-comp="${name}"${rest ? ' ' + rest.trim() : ''}`;
    return `<${name}${injected}></${name}>`;
  });

  // 2) <UserCard ...> -> <UserCard data-mw-comp="UserCard" ...>
  html = html.replace(/<([A-Z][A-Za-z0-9_]*)\b([^>]*)>/g, (_m, name, rest) => {
    if (rest && /\bdata-mw-comp=/.test(rest)) return `<${name}${rest}>`;
    const injected = rest ? ` data-mw-comp="${name}" ${rest.trim()}` : ` data-mw-comp="${name}"`;
    return `<${name}${injected}>`;
  });

  return html;
}

// 1) strip comments & string literals (keeps line breaks for positions)
function stripLiterals(src: string): string {
  return src
    // block comments
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    // line comments
    .replace(/\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '))
    // strings: ', ", `
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, m => m.replace(/[^\n]/g, ' '));
}

// 2) keep only text at brace depth 0 (replace nested blocks with spaces)
function topLevelOnly(src: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') { depth++; out += ' '; continue; }
    if (ch === '}') { depth = Math.max(0, depth - 1); out += ' '; continue; }
    out += depth === 0 ? ch : (ch === '\n' ? '\n' : ' ');
  }
  return out;
}

// 3) collect only TOP-LEVEL names (depth 0)
function collectTopLevelNames(src: string): string[] {
  const s = topLevelOnly(stripLiterals(src));
  const names = new Set<string>();

  // function foo() {}
  for (const m of s.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[1]);
  // class Foo {}
  for (const m of s.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)\b/g)) names.add(m[1]);
  // const/let/var foo (=|,|;|newline)
  for (const m of s.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/g)) names.add(m[1]);

  // Remove common compiler locals if you happen to use them
  ['props', 'ctx', 'defineProps', 'defineEmits', 'defineExpose'].forEach(n => names.delete(n));
  return Array.from(names);
}

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

// --- plugin ------------------------------------------------------------

export default function marwaSfc(entry: string = './App.marwa'): Plugin {
  return {
    name: 'vite:marwa-sfc',
    enforce: 'pre',

    transform(code, id) {
      // ----- .marwa SFC compilation -----
      if (id.endsWith('.marwa')) {
        let tpl = matchBlock(code, 'template') ?? '';
        const scriptSetupRaw = matchScriptSetup(code) ?? '';

        // tag PascalCase usage and normalize self-closing tags
        tpl = tagPascalComponents(tpl);

        // auto-import helpers from @marwajs/core (zero boilerplate)
        const autoImports = `
import * as __Marwa from '@marwajs/core';
const { defineComponent, createApp, provide, inject, ref, reactive, computed, watchEffect, effect, setComponentLoader } = __Marwa;
`;

        // auto-return if user didn't
        //const hasExplicitReturn = /\breturn\s*\{[\s\S]*?\}\s*;?/.test(scriptSetupRaw);
        //const hasExplicitReturn = /^[ \t]*return\s*\{[\s\S]*?\}\s*;?/m.test(scriptSetupRaw);
        const top = topLevelOnly(stripLiterals(scriptSetupRaw));
        const hasExplicitReturn = /^[ \t]*return\s*\{[\s\S]*?\}\s*;?/m.test(top);

        const names = hasExplicitReturn ? [] : collectTopLevelNames(scriptSetupRaw);
        // compose return: props first (spread), then names
        const autoReturn = hasExplicitReturn
          ? ''
          : `\nreturn { ...props${names.length ? ', ' + names.join(', ') : ''} };\n`;

        const scriptSetup = `
${scriptSetupRaw.trim()}
${autoReturn}
`;

        const out = `
${autoImports}
export default defineComponent({
  template: ${JSON.stringify(tpl)},
  setup(props, ctx) {
${scriptSetup.replace(/^/gm, '    ')}
  }
});
`;
        return { code: out, map: null };
      }

      // ----- main.ts/main.js bootstrapping + component loader injection -----
      if (id.endsWith('main.ts') || id.endsWith('main.js')) {
        const hasSfcImport = /\.marwa['"]/.test(code);
        const dir = path.dirname(id);
        const appPath = path.resolve(dir, entry);
        const hasApp = fs.existsSync(appPath);

        // always inject a lazy component loader (idempotent)
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

        // if user wrote their own boot, just prepend the loader once
        if (!code.includes('setComponentLoader(')) {
          return loaderInject + '\n' + code;
        }
      }
    }
  };
}
