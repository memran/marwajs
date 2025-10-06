import { describe, it, expect } from "vitest";
import { compileTemplateToIR } from "../src/index";

function compile(html: string) {
  return compileTemplateToIR(html, {
    file: "Test.marwa",
    name: "TestComponent",
  });
}

describe("compiler: basic DOM & bindings", () => {
  it("emits create/mount for simple element", () => {
    const ir = compile(`<div id="a">hello</div>`);
    expect(ir.create.join("\n")).toContain('Dom.createElement("div")');
    expect(ir.mount.join("\n")).toContain("Dom.insert");
    expect(ir.bindings.length).toBe(0);
  });

  it("binds text interpolation from {{ expr }}", () => {
    const ir = compile(`<p>hi {{msg}}</p>`);
    const textBind = ir.bindings.find((b) => b.kind === "text");
    expect(textBind).toBeTruthy();
    expect((textBind as any).expr).toContain("msg");
  });

  it("binds m-text, m-class, m-style, m-show", () => {
    const ir = compile(
      `<div m-text="title" m-class="klass" m-style="styles" m-show="visible"></div>`
    );
    const kinds = ir.bindings.map((b) => b.kind).sort();
    expect(kinds).toEqual(["class", "show", "style", "text"].sort());
  });

  it("binds generic m-* attribute as attr binding", () => {
    const ir = compile(`<input m-value="val" m-aria-label="label" />`);
    const attrs = ir.bindings.filter((b) => b.kind === "attr");
    expect(attrs.length).toBe(2);
    expect((attrs[0] as any).name).toBe("value");
  });

  it("parses @click event into event binding", () => {
    const ir = compile(`<button @click="onClick">Tap</button>`);
    const ev = ir.bindings.find((b) => b.kind === "event");
    expect(ev).toBeTruthy();
    expect((ev as any).type).toBe("click");
    expect((ev as any).handler).toContain("onClick");
  });
});
