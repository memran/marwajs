import { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const CORE_APIS = [
  'signal','effect',
  'onBeforeMount','onMounted','onBeforeUnmount','onUnmounted',
  'provide','inject'
];

export function MarwaSFC(): Plugin {
  const debug = process.env.MARWA_SFC_DEBUG === '1';

  return {
    name: 'marwa-sfc',
    enforce: 'pre',
    async transform(code, id) {
      if (!id.endsWith('.marwa')) return;

      // ---- extract blocks
      const templateMatch = code.match(/<template>([\s\S]*?)<\/template>/);
      const scriptMatch   = code.match(/<script(?:\s+setup)?>([\s\S]*?)<\/script>/);
      const styleMatch    = code.match(/<style>([\s\S]*?)<\/style>/);

      const template = (templateMatch ? templateMatch[1] : '').trim();
      let   script   = (scriptMatch ? scriptMatch[1]   : '').trim();
      const styles   = (styleMatch ? styleMatch[1]     : '').trim();

      const safeTemplate = template.replace(/`/g, '\\`');
      const safeStyles   = styles.replace(/`/g, '\\`');

      // ---- split user imports vs body (imports must be hoisted)
      const userImports: string[] = [];
      const bodyLines: string[] = [];
      for (const line of script.split('\n')) {
        if (/^\s*import\s.+from\s+['"][^'"]+['"]\s*;?\s*$/.test(line) || /^\s*import\s+['"][^'"]+['"]\s*;?\s*$/.test(line)) {
          userImports.push(line);
        } else {
          bodyLines.push(line);
        }
      }
      const body = bodyLines.join('\n');

      // ---- detect if user already imports from @marwajs/core
      const userHasCoreImport = userImports.some(l => /from\s+['"]@marwajs\/core['"]/.test(l));

      // ---- build import section
      // keep defineComponent import separate (always needed)
      const topImports: string[] = [`import { defineComponent } from '@marwajs/core';`];

      // auto-import core APIs if user didn't import from @marwajs/core
      if (!userHasCoreImport) {
        topImports.push(`import { ${CORE_APIS.join(', ')} } from '@marwajs/core';`);
      }

      // include user's own imports (hoisted)
      topImports.push(...userImports);

      const name = path.basename(id).replace(/\.marwa$/, '') || 'Anonymous';

      const out = `
${topImports.join('\n')}

export default defineComponent({
  name: '${name}',
  template: \`${safeTemplate}\`,
  styles: ${styles ? `\`${safeStyles}\`` : 'undefined'},
  setup({ app, props, ctx }) {
    (function(){
${body.split('\n').map(l => '      ' + l).join('\n')}
    }).call(ctx);
    return ctx;
  }
});
`;

      if (debug) {
        try {
          const dumpDir = path.join(process.cwd(), '.marwa-debug');
          fs.mkdirSync(dumpDir, { recursive: true });
          const outPath = path.join(dumpDir, path.basename(id) + '.js');
          fs.writeFileSync(outPath, out, 'utf8');
        } catch {}
      }

      return { code: out, map: null };
    }
  };
}
