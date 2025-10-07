import { describe, it, expect } from "vitest";
import { generateComponent } from "../src/codegen";
import { CompilerError } from "../src/errors";

describe("generateComponent", () => {
  it("produces valid code for simple IR", () => {
    const code = generateComponent({
      file: "a",
      name: "Demo",
      create: ["const e = Dom.createElement('div');"],
      mount: ["Dom.insert(e, target);"],
      bindings: [],
      imports: ["Dom"],
    });
    expect(code).toContain("export default function Demo");
    expect(code).toContain("Dom.createElement('div')");
  });

  it("throws on empty name", () => {
    expect(() =>
      generateComponent({
        file: "",
        name: "",
        create: [],
        mount: [],
        bindings: [],
        imports: [],
      })
    ).toThrow(CompilerError);
  });
});

describe("codegen: emit bindings", () => {
  it("wraps event handler in function (no immediate call)", () => {
    const code = generateComponent({
      file: "a",
      name: "Demo",
      create: ["const e = Dom.createElement('button');"],
      mount: ["Dom.insert(e, target);"],
      bindings: [
        { kind: "event", target: "e", type: "click", handler: "inc()" },
      ],
      imports: ["Dom"],
    });
    expect(code).toContain(`onEvent((ctx as any).app, e, "click", (e)=>(`); // wrapper added
    expect(code).toContain("inc()");
  });

  it("emits text/class/style/show/attr", () => {
    const code = generateComponent({
      file: "a",
      name: "Demo",
      create: [
        "const d = Dom.createElement('div'); const t = Dom.createText('');",
      ],
      mount: ["Dom.insert(d, target); Dom.insert(t, d);"],
      bindings: [
        { kind: "text", target: "t", expr: "msg" },
        { kind: "class", target: "d", expr: "klass" },
        { kind: "style", target: "d", expr: "styles" },
        { kind: "show", target: "d", expr: "visible" },
        { kind: "attr", target: "d", name: "title", expr: "tt" },
      ],
      imports: ["Dom"],
    });
    expect(code).toContain("bindText");
    expect(code).toContain("bindClass");
    expect(code).toContain("bindStyle");
    expect(code).toContain("bindShow");
    expect(code).toContain(`bindAttr(d, "title"`);
  });
});
