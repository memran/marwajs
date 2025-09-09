import type { Plugin } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compileSFC } from './transform.js';
import { readSFC } from './sfc.js';
import { generateRoutes } from './router-gen.js';
import { glob } from 'glob';

type Opts = {
  pages?: string;
  directivePrefix?: string;
  /** Directories to scan for auto components */
  componentDirs?: string[]; // e.g., ['src/components', 'src/pages/components']
  /** Eager (static import) or lazy (dynamic import) */
  componentLoad?: 'eager' | 'lazy';
};

export default function marwaPlugin(opts: Opts = {}): Plugin {
  let root = process.cwd();
  const pages = opts.pages ?? 'src/pages';
  const directivePrefix = opts.directivePrefix ?? ':';
  const componentLoad = opts.componentLoad ?? 'eager';
  const componentDirs = opts.componentDirs ?? ['src/components'];

  // Name → absolute path map
  const compMap = new Map<string, string>();

  const toPascal = (s: string) =>
    s.replace(/(^\w|[-_]\w)/g, m => m.replace(/[-_]/, '').toUpperCase());

  async function scanComponents() {
    compMap.clear();
    for (const dir of componentDirs) {
      const absDir = path.resolve(root, dir);
      const files = await glob('**/*.marwa', { cwd: absDir, absolute: true });
      for (const f of files) {
        const base = path.basename(f, '.marwa');
        // Allow both PascalCase and kebab-case usage in templates
        compMap.set(toPascal(base), f);
        compMap.set(toPascal(base.replace(/-/g, '_')), f);
      }
    }
  }

  function resolveComponent(name: string, fromFile: string): string | undefined {
    const p = compMap.get(name);
    if (!p) return undefined;
    // Use POSIX-like path for Vite
    const rel = path.posix.normalize(p.replace(/\\/g, '/'));
    return rel;
  }

  return {
    name: 'marwa-compiler',
    enforce: 'pre',
    configResolved(cfg) { root = cfg.root; },
    async buildStart() {
      await scanComponents();
      const out = path.join(root, 'src/.marwa/routes.gen.ts');
      await generateRoutes(path.join(root, pages), out);
    },
    async handleHotUpdate(ctx) {
      if (ctx.file.endsWith('.marwa')) {
        await scanComponents();
        const out = path.join(root, 'src/.marwa/routes.gen.ts');
        await generateRoutes(path.join(root, pages), out);
      }
    },
    resolveId(id) { if (id === 'virtual:marwa-routes') return id; },
    async load(id) {
      if (id === 'virtual:marwa-routes') {
        return `export { routes } from '${path.posix.join('/src/.marwa/routes.gen.ts')}';`;
      }
      if (id.endsWith('.marwa')) {
        const src = readSFC(id);
        const { code } = compileSFC(src, {
          file: id,
          directivePrefix,
          prod: process.env.NODE_ENV === 'production',
          resolveComponent,
          componentLoad
        });
        return code;
      }
    },
    async transform(_code, _id) { return null; }
  };
}
