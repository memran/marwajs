import { compileSFC } from "../src/index";
import { parseSFC, transpileScript } from "../src/sfc/parseSFC";
import { describe, it, expect } from "vitest";
import { CompilerError } from "../src/errors";

const demo = `<template>\n <div class=\"box\" m-class=\"klass\">Hello {{name}}<span m-text=\"title\"></span></div>\n</template>\n<script lang=\"ts\">\n export const answer: number = 42;\n</script>`;

describe("SFC compile (SWC + template)", () => {
  it("produces JS code string with component factory", () => {
    const { code } = compileSFC(demo, "Demo.marwa");
    expect(typeof code).toBe("string");
    expect(code).toContain("export default function Demo");
    expect(code).toContain('Dom.createElement("div")');
  });
});
describe("sfc: parse & transpile — more", () => {
  it("supports lang=ts transpile", () => {
    const sfc = parseSFC(
      `<template>x</template><script lang="ts">export const n: number = 1</script>`,
      "x.marwa"
    );
    const js = transpileScript(sfc.script, "x.marwa");
    expect(js).toContain("const n = 1");
  });

  it("accepts style scoped flag", () => {
    const sfc = parseSFC(
      `<template>x</template><style scoped>p{color:red}</style>`,
      "x.marwa"
    );
    expect(sfc.style?.scoped).toBe(true);
    expect(sfc.style?.content).toContain("color:red");
  });

  it("template is required", () => {
    expect(() => parseSFC(`<script/>`, "bad.marwa")).toThrow(CompilerError);
  });
});
