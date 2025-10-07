import { describe, it, expect } from "vitest";
import { compileTextExpression, splitTextExpressionParts } from "../src/text";
import { CompilerError } from "../src/errors";

describe("compileTextExpression", () => {
  it("returns null when no interpolation", () => {
    expect(compileTextExpression("hello")).toBeNull();
  });

  it("extracts expression inside {{ }}", () => {
    expect(compileTextExpression("hello {{name}}")).toBe("name");
  });

  it("throws on null value", () => {
    // @ts-expect-error
    expect(() => compileTextExpression(null)).toThrow(CompilerError);
  });

  it("throws on empty {{ }}", () => {
    expect(() => compileTextExpression("{{   }}")).toThrow(
      /Empty interpolation/
    );
  });
});
describe("text: splitTextExpressionParts", () => {
  it("returns static only when no {{}}", () => {
    expect(splitTextExpressionParts("hello")).toEqual([
      { kind: "static", value: "hello" },
    ]);
  });

  it("splits static + expr + static", () => {
    const parts = splitTextExpressionParts("Hi {{name}}!");
    expect(parts).toEqual([
      { kind: "static", value: "Hi " },
      { kind: "expr", value: "name" },
      { kind: "static", value: "!" },
    ]);
  });

  it("supports multiple {{}}", () => {
    const parts = splitTextExpressionParts("A {{x}} B {{y()}} C");
    expect(parts.map((p) => p.kind)).toEqual([
      "static",
      "expr",
      "static",
      "expr",
      "static",
    ]);
  });

  it("throws on empty {{ }}", () => {
    expect(() => splitTextExpressionParts("bad {{   }}")).toThrow(
      CompilerError
    );
  });
});

describe("text: compileTextExpression (legacy)", () => {
  it("extracts first expr", () => {
    expect(compileTextExpression("a {{x}} b {{y}}")).toBe("x");
  });
});
