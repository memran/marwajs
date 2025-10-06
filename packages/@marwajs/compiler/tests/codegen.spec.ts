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
