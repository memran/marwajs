import { describe, it, expect } from "vitest";
import { compileTemplateToIR } from "../src/index";

function compile(html: string) {
  return compileTemplateToIR(html, { file: "T", name: "C" });
}

describe("index: mixed text compilation", () => {
  it("emits static + bound nodes for mixed text", () => {
    const ir = compile(`<span>Hi {{user}}!</span>`);
    const create = ir.create.join("\n");
    const bindKinds = ir.bindings.map((b) => b.kind);
    expect(create).toMatch(/Dom.createText\("Hi "\)/);
    expect(bindKinds).toContain("text");
  });

  it("handles multiple expressions", () => {
    const ir = compile(`<p>{{a}} + {{b}}</p>`);
    const bindCount = ir.bindings.filter((b) => b.kind === "text").length;
    expect(bindCount).toBe(2);
  });
});
