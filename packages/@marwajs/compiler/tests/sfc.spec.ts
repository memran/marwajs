import { compileSFC } from "../src/index";
import { describe, it, expect } from "vitest";

const demo = `<template>\n <div class=\"box\" m-class=\"klass\">Hello {{name}}<span m-text=\"title\"></span></div>\n</template>\n<script lang=\"ts\">\n export const answer: number = 42;\n</script>`;

describe("SFC compile (SWC + template)", () => {
  it("produces JS code string with component factory", () => {
    const { code } = compileSFC(demo, "Demo.marwa");
    expect(typeof code).toBe("string");
    expect(code).toContain("export default function Demo");
    expect(code).toContain('Dom.createElement("div")');
  });
});
