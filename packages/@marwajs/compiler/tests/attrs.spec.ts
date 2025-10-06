import { describe, it, expect } from "vitest";
import { normalizeAttributes } from "../src/attrs";
import { CompilerError } from "../src/errors";

describe("normalizeAttributes", () => {
  it("converts primitives to string", () => {
    expect(normalizeAttributes({ id: 10 })).toEqual({ id: "10" });
  });

  it("joins array attributes with space", () => {
    expect(normalizeAttributes({ class: ["a", "b"] })).toEqual({
      class: "a b",
    });
  });

  it("throws on null/undefined", () => {
    expect(() => normalizeAttributes({ bad: undefined as any })).toThrow(
      CompilerError
    );
    expect(() => normalizeAttributes({ bad: null as any })).toThrow(
      /must not be null/
    );
  });

  it("handles boolean attributes", () => {
    expect(normalizeAttributes({ disabled: true })).toEqual({ disabled: "" });
  });
});
