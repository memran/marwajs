import { Plugin } from 'vite';

export function MarwaSFC(): Plugin {
  return {
    name: 'marwa-sfc',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.marwa')) return;

      const templateMatch = code.match(/<template>([\s\S]*?)<\/template>/);
      const scriptMatch   = code.match(/<script(?:\s+setup)?>([\s\S]*?)<\/script>/);
      const styleMatch    = code.match(/<style>([\s\S]*?)<\/style>/);

      const template = templateMatch ? templateMatch[1].trim() : '';
      let script     = scriptMatch ? scriptMatch[1].trim() : '';
      const styles   = styleMatch ? styleMatch[1].trim() : '';

      const autoImports = [
        'signal','effect',
        'onBeforeMount','onMounted','onBeforeUnmount','onUnmounted',
        'provide','inject'
      ];

      const already = /from\s+['"]@marwajs\/core['"]/.test(script);
      if (!already) {
        script = `import { ${autoImports.join(', ')} } from '@marwajs/core';\n${script}`;
      }

      const name = id.split('/').pop()?.replace(/\.marwa$/, '') || 'Anonymous';

      const result = `
        import { defineComponent } from '@marwajs/core';
        export default defineComponent({
          name: '${name}',
          template: \`${template.replace(/`/g, '\\`')}\`,
          styles: ${styles ? `\`${styles.replace(/`/g, '\\`')}\`` : 'undefined'},
          setup({ app, props, ctx }) {
            ${script}
            return ctx;
          }
        });
      `;
      return { code: result, map: null };
    }
  };
}
