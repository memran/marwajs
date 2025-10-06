import { transformSync } from "@swc/core";
import { CompilerError } from "../errors";
import type { SFC } from "../types";

export function parseSFC(code: string, file: string): SFC {
  if (code == null)
    throw new CompilerError(`SFC source is null/undefined for ${file}`);

  const t = /<template>([\s\S]*?)<\/template>/m.exec(code);
  if (!t || t[1] == null)
    throw new CompilerError(`<template> block is required in ${file}`);
  const template = t[1];

  const s = /<script(?:\s+lang=\"(ts|js)\")?>([\s\S]*?)<\/script>/m.exec(code);
  const st = /<style(\s+scoped)?>([\s\S]*?)<\/style>/m.exec(code);

  const script = s
    ? {
        content: String(s[1 ? 2 : 2] ?? "").trim(),
        lang: (s[1] as "ts" | "js" | undefined) ?? "js",
      }
    : null;
  const style = st
    ? { content: String(st[2] ?? "").trim(), scoped: !!st[1] }
    : null;

  return { template, script, style };
}

export function transpileScript(
  block: SFC["script"],
  filename: string
): string {
  if (!block) return "";
  if (block.lang === "js") return block.content;
  const out = transformSync(block.content, {
    filename,
    jsc: { target: "es2022", parser: { syntax: "typescript" } },
    module: { type: "es6" },
  });
  return out.code;
}
