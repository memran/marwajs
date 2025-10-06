import { describe, it, expect } from "vitest";
import { parseSFC, transpileScript } from "../src/sfc/parseSFC";
import { CompilerError } from "../src/errors";

describe("parseSFC", () => {
  it("extracts template, script, and style", () => {
    const sfc = parseSFC(
      `<template><div/></template><script>const x=1;</script><style>p{}</style>`,
      "x.marwa"
    );
    expect(sfc.template).toContain("div");
    expect(sfc.script?.content).toContain("x=1");
  });

  it("throws if missing template", () => {
    expect(() => parseSFC("<script/>", "no-template.marwa")).toThrow(
      CompilerError
    );
  });
});

describe("transpileScript", () => {
  it("returns JS unchanged for lang=js", () => {
    expect(
      transpileScript({ content: "const a=1;", lang: "js" }, "a")
    ).toContain("const a=1");
  });
});
