import { normalizeAttributes } from "../src/attrs";
import { compileTextExpression } from "../src/text";
import { parseEventAttribute } from "../src/events";
import { parseHTML } from "../src/html/parse";
import { CompilerError } from "../src/errors";
import { describe, it, expect } from "vitest";

describe("strict null-safety errors", () => {
  it("throws on null/undefined attribute values", () => {
    expect(() => normalizeAttributes({ a: undefined as any })).toThrow(
      CompilerError
    );
    expect(() => normalizeAttributes({ a: null as any })).toThrow(
      /must not be null or undefined/
    );
  });

  it("throws on empty interpolation {{ }}", () => {
    expect(() => compileTextExpression("before {{ }} after")).toThrow(
      CompilerError
    );
  });

  it("throws on invalid event attribute name", () => {
    expect(() => parseEventAttribute("click" as any)).toThrow(
      /Invalid event attribute/
    );
    expect(() => parseEventAttribute("@" as any)).toThrow(/must not be empty/);
  });

  it("parseHTML rejects null input", () => {
    // @ts-expect-error intentional null
    expect(() => parseHTML(null)).toThrow(CompilerError);
  });
});
