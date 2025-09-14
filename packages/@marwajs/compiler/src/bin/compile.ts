#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generateComponent } from "../codegen.js";
import { compileSFC } from "../sfc/compileSFC.js";

async function main() {
  const [input, outFile] = process.argv.slice(2);
  if (!input || !outFile) {
    console.log(`Usage:
  marwa-compile <input.[ir|marwa]> <output.js>`);
    process.exit(1);
  }

  const inAbs = path.resolve(process.cwd(), input);
  const outAbs = path.resolve(process.cwd(), outFile);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });

  if (input.endsWith(".marwa")) {
    const code = await fs.readFile(inAbs, "utf8");
    const { code: js } = compileSFC(code, inAbs);
    await fs.writeFile(outAbs, js, "utf8");
    console.log(
      `[marwa-compile] SFC → ${path.relative(process.cwd(), outAbs)}`
    );
    return;
  }

  // IR module path
  const mod = await import(pathToFileURL(inAbs).href);
  const ir =
    typeof mod.default === "function" ? await mod.default() : mod.default;
  const { code } = generateComponent(ir);
  await fs.writeFile(outAbs, code, "utf8");
  console.log(`[marwa-compile] IR → ${path.relative(process.cwd(), outAbs)}`);
}

main().catch((err) => {
  console.error("[marwa-compile] Error:", err);
  process.exit(1);
});
