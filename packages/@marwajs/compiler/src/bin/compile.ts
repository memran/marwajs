#!/usr/bin/env node
/**
 * MarwaJS Compiler CLI
 * --------------------
 * Usage:
 *   marwa-compile --in src --outDir dist
 *   marwa-compile --in src/App.marwa --outDir dist
 *   marwa-compile --stdin < input.marwa > output.js
 * Options:
 *   --in       Path to a file or directory. If a directory, all *.marwa files are compiled.
 *   --outDir   Output directory (required unless --stdin).
 *   --watch    Watch mode (only with --in).
 *   --ext      Source extension to search in directories (default: ".marwa")
 *   --silent   Reduce logs
 *
 * Notes:
 * - Mirrors source folder structure under outDir.
 * - Exits with non-zero code on fatal errors.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Import your SFC compiler
import { compileSFC } from "../index.js";
type Args = {
  in?: string;
  outDir?: string;
  watch?: boolean;
  stdin?: boolean;
  ext: string;
  silent?: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv: string[]): Args {
  const args: Args = { ext: ".marwa" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") args.in = argv[++i];
    else if (a === "--outDir") args.outDir = argv[++i];
    else if (a === "--watch") args.watch = true;
    else if (a === "--stdin") args.stdin = true;
    else if (a === "--ext") args.ext = argv[++i] || ".marwa";
    else if (a === "--silent") args.silent = true;
    else if (a === "-h" || a === "--help") helpAndExit();
    else {
      // Allow single positional for --in
      if (!args.in) args.in = a;
      else helpAndExit(`Unknown arg: ${a}`);
    }
  }
  return args;
}

function helpAndExit(msg?: string): never {
  if (msg) console.error("[marwa-compile] " + msg + "\n");
  console.log(
    `MarwaJS Compiler CLI

Usage:
  marwa-compile --in src --outDir dist
  marwa-compile --in src/App.marwa --outDir dist
  marwa-compile --stdin < input.marwa > output.js

Options:
  --in       Path to a file or directory. If a directory, all *.marwa are compiled.
  --outDir   Output directory (required unless --stdin).
  --watch    Watch mode (only with --in).
  --ext      Source extension to search in directories (default: ".marwa")
  --silent   Reduce logs
  -h, --help Show help
`
  );
  process.exit(msg ? 1 : 0);
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function relOutPath(srcRoot: string, file: string, outDir: string): string {
  const rel = path.relative(srcRoot, file);
  const outRel = rel.replace(/\.[^.]+$/g, ".js");
  return path.join(outDir, outRel);
}

function compileOne(file: string, outFile: string, silent = false) {
  const code = fs.readFileSync(file, "utf8");
  const { code: js } = compileSFC(code, file);
  ensureDir(path.dirname(outFile));
  fs.writeFileSync(outFile, js, "utf8");
  if (!silent)
    console.log(
      `✔ Compiled ${path.relative(process.cwd(), file)} → ${path.relative(
        process.cwd(),
        outFile
      )}`
    );
}

function walkDir(dir: string, ext: string, out: string, silent = false) {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (e.isFile() && p.endsWith(ext)) {
        const outFile = relOutPath(dir, p, out);
        compileOne(p, outFile, silent);
      }
    }
  }
}

function watchDir(dir: string, ext: string, outDir: string, silent = false) {
  if (!silent) console.log(`👀 Watching ${dir} for *${ext} changes...`);
  const compileFile = (p: string) => {
    if (!p.endsWith(ext)) return;
    // Find nearest source root (dir) to mirror structure relative to that root.
    const outFile = relOutPath(dir, p, outDir);
    try {
      compileOne(p, outFile, silent);
    } catch (err: any) {
      console.error(`✖ Compile error in ${p}\n${err?.stack || err}`);
    }
  };

  // Recursive watch (supported on Windows/macOS; Linux depends on Node/libc)
  fs.watch(dir, { recursive: true }, (event, filename) => {
    if (!filename) return;
    const full = path.join(dir, filename.toString());
    if (isFile(full)) compileFile(full);
  });
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.stdin) {
    // Read stdin and compile to stdout
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const input = Buffer.concat(chunks).toString("utf8");
    const { code } = compileSFC(input, "<stdin>");
    process.stdout.write(code);
    return;
  }

  if (!args.in) helpAndExit("Missing --in");
  if (!args.outDir) helpAndExit("Missing --outDir");

  const inPath = path.resolve(process.cwd(), args.in);
  const outDir = path.resolve(process.cwd(), args.outDir);
  const ext = args.ext.startsWith(".") ? args.ext : `.${args.ext}`;

  if (isDir(inPath)) {
    walkDir(inPath, ext, outDir, !!args.silent);
    if (args.watch) {
      watchDir(inPath, ext, outDir, !!args.silent);
      // keep process alive
      process.stdin.resume();
    }
  } else if (isFile(inPath)) {
    const outFile = path.join(
      outDir,
      path.basename(inPath).replace(/\.[^.]+$/g, ".js")
    );
    compileOne(inPath, outFile, !!args.silent);
    if (args.watch) {
      if (!args.silent) console.log(`👀 Watching file ${inPath}...`);
      fs.watch(path.dirname(inPath), { recursive: false }, () => {
        if (isFile(inPath)) {
          try {
            compileOne(inPath, outFile, !!args.silent);
          } catch (err: any) {
            console.error(`✖ Compile error in ${inPath}\n${err?.stack || err}`);
          }
        }
      });
      process.stdin.resume();
    }
  } else {
    helpAndExit(`Not found: ${args.in}`);
  }
}

main().catch((err) => {
  console.error("✖ Fatal:", err?.stack || err);
  process.exit(1);
});
