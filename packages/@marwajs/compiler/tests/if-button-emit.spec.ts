// tests/if-button-emit.spec.ts
import { describe, it, expect } from "vitest";
import { compileSFC } from "../src/sfc/compileSFC";

describe("compiler emit > :if cluster emits button branch", () => {
  it("includes createElement('button'), bindIf and click handler", () => {
    const sfc = `
<template>
  <template :if="flag"><button @click="hit()">OK</button></template>
  <template :else-if="alt"><span>ALT</span></template>
  <template :else><p>NO</p></template>
</template>
<script>
let flag = true, alt = false;
function hit(){ return 1 }
</script>`.trim();

    const { code } = compileSFC(sfc, "/virtual/IfButtonEmit.marwa");

    expect(code.includes(`Dom.createElement("button")`)).toBe(true);
    expect(code.includes(`bindIf`)).toBe(true);
    expect(code.includes(`"click"`)).toBe(true);
    expect(code).toMatch(/hit\(\)/);
  });
});
