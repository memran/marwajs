import { describe, it, expect } from "vitest";
import { parseHTML } from "../src/html/parse";
import { CompilerError } from "../src/errors";

describe("parseHTML", () => {
  it("parses single div", () => {
    const ast = parseHTML("<div>Hello</div>");
    //[ { type: 'el', tag: 'div', attrs: {}, children: [ [Object] ] } ]

    expect(ast[0].type).toBe("el");
    //@ts-expect-error
    expect(ast[0].tag).toBe("div");
    //@ts-expect-error
    expect(ast[0].attrs).toEqual({});
    //@ts-expect-error
    expect(ast[0].children.length).toBe(1);
    //@ts-expect-error
    expect(ast[0].children[0]).toMatchObject({ type: "text", value: "Hello" });
    //
    //console.log(ast[0].children[0].type);
  });

  it("includes text node children", () => {
    const ast = parseHTML("<p>Hi</p>");
    //@ts-expect-error
    expect(ast[0].children[0]).toMatchObject({ type: "text", value: "Hi" });
  });

  it("throws on null input", () => {
    // @ts-expect-error
    expect(() => parseHTML(null)).toThrow(CompilerError);
  });
});
describe("html/parse edge cases", () => {
  it("parses sibling roots", () => {
    const ast = parseHTML("<div>A</div><span>B</span>");
    expect(ast.length).toBe(2);
    expect(ast[0]).toMatchObject({ type: "el", tag: "div" });
    expect(ast[1]).toMatchObject({ type: "el", tag: "span" });
  });

  it("parses nested with attributes", () => {
    const ast = parseHTML(`<div id="x"><em class="c">t</em></div>`);
    const em = (ast[0] as any).children[0];
    expect(em).toMatchObject({ type: "el", tag: "em" });
    expect(em.attrs.class).toBe("c");
  });

  it("throws on null input", () => {
    // @ts-expect-error testing null
    expect(() => parseHTML(null)).toThrow(CompilerError);
  });
});
