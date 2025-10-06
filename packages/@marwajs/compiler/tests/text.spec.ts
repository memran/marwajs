import { describe, it, expect } from "vitest";
import { compileTextExpression } from "../src/text";
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
