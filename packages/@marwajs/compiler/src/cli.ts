#!/usr/bin/env node
/**
 * Single command:
 *   marwa compile [--watch] [--prod] [--root .] [--entry src/main.ts] [--pages src/pages] [--history browser]
 *
 * Defaults:
 *   root=PWD, entry=src/main.ts, pages=src/pages, history=browser
 *
 * Always:
 *   1) Scan pages + inject into entry BETWEEN MARKERS
 *   2) tsc compile (-p <root>/tsconfig.json)
 *   3) watch: re-inject + recompile on change
 *   4) prod: bundle with esbuild (minify/treeshake) → dist/app.js
 */
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import esbuild from 'esbuild';
import chokidar from 'chokidar';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { scanAndInject } from './routing.js';

type History = 'browser' | 'hash';
type Args = { root: string; entry: string; pages: string; watch: boolean; prod: boolean; history: History };

function parseArgs(): Args {
  const a = process.argv.slice(2);
  let root = process.cwd();
  let entry = resolve(root, 'src/main.ts');
  let pages = resolve(root, 'src/pages');
  let watch = false;
  let prod = false;
  let history: History = 'browser';

  for (let i = 0; i < a.length; i++) {
    const k = a[i], v = a[i + 1];
    if (k === 'compile') { /* noop */ }
    else if (k === '--root' && v) { root = resolve(v); i++; }
    else if (k === '--entry' && v) { entry = resolve(v); i++; }
    else if (k === '--pages' && v) { pages = resolve(v); i++; }
    else if (k === '--watch') { watch = true; }
    else if (k === '--prod') { prod = true; }
    else if (k === '--history' && v) { history = (v as History); i++; }
  }
  return { root, entry, pages, watch, prod, history };
}

async function tsc(root: string, tsconfig?: string) {
  // Resolve the local TypeScript CLI entry using Node resolution rooted at the app
  const req = createRequire(import.meta.url);
  let tscBin: string;
  try {
    // finds <root>/node_modules/typescript/bin/tsc (or nearest in workspace)
    tscBin = req.resolve('typescript/bin/tsc', { paths: [root] });
  } catch {
    console.error('[marwa] TypeScript not found. Install it in your workspace/app:');
    console.error('  npm i -D typescript');
    throw new Error('typescript not installed');
  }

  const tsconfigPath = tsconfig ?? resolve(root, 'tsconfig.json');

  return new Promise<void>((res, rej) => {
    // Run "node <tscBin> -p <tsconfigPath>" to avoid shell/npx issues on Windows
    const p = spawn(process.execPath, [tscBin, '-p', tsconfigPath], {
      stdio: 'inherit',
      cwd: root
    });
    p.on('close', (code) =>
      code === 0 ? res() : rej(new Error(`[marwa] tsc exited with code ${code}`))
    );
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
  const appRoot = resolve(root, 'src');
  if (existsSync(pagesAbs)) {
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
    console.log('[marwa] production bundle: dist/app.js');
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

  let running = false, pending = false;
  const run = async () => {
    if (running) { pending = true; return; }
    running = true;
    try {
      await injectRoutesOnce(args.root, args.entry, args.pages, args.history);
      await tsc(args.root);
      console.log('[marwa] compiled');
    } catch (e) {
      console.error('[marwa] compile error', e instanceof Error ? e.message : e);
    } finally {
      running = false;
      if (pending) { pending = false; run(); }
    }
  };

  console.log('[marwa] watching…');
  await run();
  watcher.on('all', run);
}

async function main() {
  const args = parseArgs();
  if (args.watch) await compileWatch(args);
  else await compileOnce(args);
}
main().catch(e => { console.error('[marwa] fatal', e); process.exit(1); });
