import { describe, it, expect } from "vitest";
import { compileTemplateToIR } from "../src/index";
import { CompilerError } from "../src/errors";

const compile = (h: string) => compileTemplateToIR(h, { file: "F", name: "N" });

describe("m-if chain validations", () => {
  it("throws on empty m-if", () => {
    expect(() => compile(`<div m-if=""></div>`)).toThrow(CompilerError);
  });
  it("throws on empty m-else-if", () => {
    expect(() =>
      compile(`<div m-if="x"></div><div m-else-if=""></div>`)
    ).toThrow(CompilerError);
  });
  it("throws on double m-else", () => {
    expect(() =>
      compile(`<div m-if="x"></div><div m-else></div><div m-else></div>`)
    ).toThrow(CompilerError);
  });
  it("throws when m-else-if after m-else", () => {
    expect(() =>
      compile(`<div m-if="x"></div><div m-else></div><div m-else-if="y"></div>`)
    ).toThrow(CompilerError);
  });
});

describe("m-switch validations", () => {
  it("throws on empty m-switch expr", () => {
    expect(() => compile(`<div m-switch=""></div>`)).toThrow(CompilerError);
  });
  it("throws on switch with no cases/default", () => {
    expect(() => compile(`<div m-switch="x"></div>`)).toThrow(CompilerError);
  });
  it("throws on empty m-case", () => {
    expect(() =>
      compile(`<div m-switch="x"></div><div m-case=""></div>`)
    ).toThrow(CompilerError);
  });
  it("throws on m-case after m-default", () => {
    expect(() =>
      compile(
        `<div m-switch="x"></div><div m-default></div><div m-case="'a'"></div>`
      )
    ).toThrow(CompilerError);
  });
  it("throws on double m-default", () => {
    expect(() =>
      compile(
        `<div m-switch="x"></div><div m-default></div><div m-default></div>`
      )
    ).toThrow(CompilerError);
  });
});
