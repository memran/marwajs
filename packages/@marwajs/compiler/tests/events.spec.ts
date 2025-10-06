import { describe, it, expect } from "vitest";
import { parseEventAttribute } from "../src/events";
import { CompilerError } from "../src/errors";

describe("parseEventAttribute", () => {
  it("parses @click correctly", () => {
    expect(parseEventAttribute("@click")).toEqual({ type: "click" });
  });

  it("throws if missing @", () => {
    expect(() => parseEventAttribute("click")).toThrow(CompilerError);
  });

  it("throws if empty type", () => {
    expect(() => parseEventAttribute("@")).toThrow(/empty/);
  });
});
