#!/usr/bin/env node
/**
 * MarwaJS single CLI:
 *   marwa compile [--watch] [--prod] [--root .] [--entry src/main.ts] [--pages src/pages] [--history browser]
 *
 * Defaults:
 *   root    = process.cwd()
 *   entry   = <root>/src/main.ts
 *   pages   = <root>/src/pages
 *   history = browser
 *
 * Behavior:
 *   • Always (re)scans pages and injects routes BEFORE compiling.
 *   • Runs `tsc -p <root>/tsconfig.json`.
 *   • --watch: watches .marwa/.ts and re-injects + recompiles on change.
 *   • --prod: after compile, bundles with esbuild (minify + treeshake) to <root>/dist/app.js.
 */
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import esbuild from 'esbuild';
import chokidar from 'chokidar';
import { spawn } from 'child_process';
import { scanAndInject } from './routing.js';

type History = 'browser' | 'hash';
type Args = {
  cmd: 'compile';
  root: string;
  entry: string;
  pages: string;
  watch: boolean;
  prod: boolean;
  history: History;
};

function parseArgs(): Args {
  const a = process.argv.slice(2);
  let cmd: 'compile' = 'compile';
  let root = process.cwd();
  let entry = resolve(root, 'src/main.ts');
  let pages = resolve(root, 'src/pages');
  let watch = false;
  let prod = false;
  let history: History = 'browser';

  for (let i = 0; i < a.length; i++) {
    const k = a[i], v = a[i + 1];
    if (k === 'compile') { cmd = 'compile'; }
    else if (k === '--root' && v) { root = resolve(v); i++; }
    else if (k === '--entry' && v) { entry = resolve(v); i++; }
    else if (k === '--pages' && v) { pages = resolve(v); i++; }
    else if (k === '--watch') { watch = true; }
    else if (k === '--prod') { prod = true; }
    else if (k === '--history' && v) { history = (v as History); i++; }
  }

  return { cmd, root, entry, pages, watch, prod, history };
}

async function tsc(root: string, tsconfig?: string) {
  return new Promise<void>((res, rej) => {
    const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const p = spawn(bin, ['tsc', '-p', tsconfig ?? resolve(root, 'tsconfig.json')], {
      stdio: 'inherit',
      cwd: root
    });
    p.on('close', (code) => code === 0 ? res() : rej(new Error(`tsc exit ${code}`)));
  });
}

async function bundleProd(root: string, entry: string) {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile: join(root, 'dist', 'app.js'),
    minify: true,
    treeShaking: true,
    sourcemap: false,
    define: { __DEV__: 'false' }
  });
}

async function injectRoutesOnce(root: string, entry: string, pagesAbs: string, history: History) {
  // appRoot is <root>/src (entry is already absolute)
  const appRoot = resolve(root, 'src');
  if (existsSync(pagesAbs)) {
    // pagesDir must be relative to appRoot (src)
    const pagesRel = pagesAbs.replace(appRoot, '').replace(/^[/\\]/, '').replace(/\\/g, '/');
    await scanAndInject({ appRoot, entryFile: entry, pagesDir: pagesRel, history });
    console.log('[marwa] routes injected');
  }
}

async function compileOnce(args: Args) {
  await injectRoutesOnce(args.root, args.entry, args.pages, args.history);
  await tsc(args.root);
  if (args.prod) {
    await bundleProd(args.root, args.entry);
    console.log('[marwa] production bundle ready: dist/app.js');
  }
}

async function compileWatch(args: Args) {
  const watcher = chokidar.watch(
    [
      resolve(args.root, 'src/**/*.marwa'),
      resolve(args.root, 'src/**/*.ts'),
      resolve(args.root, 'src/**/*.tsx'),
      args.pages,
      args.entry
    ],
    { cwd: args.root, ignoreInitial: true, ignored: ['dist/**', 'node_modules/**'] }
  );

  let running = false;
  let pend = false;
  const run = async () => {
    if (running) { pend = true; return; }
    running = true;
    try {
      await injectRoutesOnce(args.root, args.entry, args.pages, args.history);
      await tsc(args.root);
      console.log('[marwa] compiled');
    } catch (e) {
      // errors already shown by tsc
      console.error('[marwa] compile error', e instanceof Error ? e.message : e);
    } finally {
      running = false;
      if (pend) { pend = false; run(); }
    }
  };

  console.log('[marwa] watching for changes…');
  watcher.on('all', run);
  // do an initial build before watching
  await run();
}

async function main() {
  const args = parseArgs();
  if (args.cmd !== 'compile') {
    console.error('Usage: marwa compile [--watch] [--prod] [--root .] [--entry src/main.ts] [--pages src/pages] [--history browser|hash]');
    process.exit(1);
  }

  if (args.watch && args.prod) {
    console.warn('[marwa] --watch and --prod together: running watch without prod bundling');
  }

  if (args.watch) {
    await compileWatch(args);
  } else {
    await compileOnce(args);
  }
}

main().catch((e) => {
  console.error('[marwa] fatal', e);
  process.exit(1);
});
