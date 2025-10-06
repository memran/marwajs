import { describe, it, expect } from "vitest";
import { parseHTML } from "../src/html/parse";
import { CompilerError } from "../src/errors";

describe("parseHTML", () => {
  it("parses single div", () => {
    const ast = parseHTML("<div>Hello</div>");
    expect(ast[0].type).toBe("el");
    expect(ast[0].tag).toBe("div");
  });

  it("includes text node children", () => {
    const ast = parseHTML("<p>Hi</p>");
    expect(ast[0].children[0]).toMatchObject({ type: "text", value: "Hi" });
  });

  it("throws on null input", () => {
    // @ts-expect-error
    expect(() => parseHTML(null)).toThrow(CompilerError);
  });
});
