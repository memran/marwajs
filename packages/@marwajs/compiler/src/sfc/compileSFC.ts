import { parseSFC } from "./parse";
import { compileTemplateToIR } from "../template/compile";
import { generateComponent } from "../codegen";
import crypto from "node:crypto";

export function compileSFC(code: string, file: string): { code: string } {
  const sfc = parseSFC(code, file);

  // scope id for <style scoped>
  const scoped = !!sfc.style?.attrs?.scoped;
  const scopeAttr = scoped
    ? `data-mw-${hash(file + (sfc.style?.content ?? ""))}`
    : undefined;

  // split script into imports (hoisted) and setup body
  const { hoisted, setup } = splitScript(sfc.script.content);

  const ir = compileTemplateToIR(sfc.template.content, {
    file: sfc.file,
    name: guessName(file),
    scopeAttr,
  });

  // allow script prelude (setup) to run inside defineComponent setup
  (ir as any).prelude = setup ? [setup] : [];
  (ir as any).imports = []; // runtime imports added by codegen
  const body = generateComponent(ir).code;

  const module = [
    ...hoisted, // user imports (signal, etc.)
    body,
  ].join("\n");

  return { code: module };
}

function splitScript(src: string): { hoisted: string[]; setup: string } {
  const lines = src.split("\n");
  const hoisted: string[] = [];
  const rest: string[] = [];
  for (const l of lines) {
    if (/^\s*import\s/.test(l)) hoisted.push(l);
    else if (l.trim()) rest.push(l);
  }
  return { hoisted, setup: rest.join("\n") };
}

function hash(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);
}
function guessName(file: string) {
  const base = file.split(/[\\/]/).pop() || "Component";
  return base.replace(/\.[^.]+$/, "");
}
