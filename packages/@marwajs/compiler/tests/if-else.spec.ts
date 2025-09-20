// tests/if-else.spec.ts
import { describe, it, expect } from "vitest";
import { compileSFC } from "../src/sfc/compileSFC";

describe("compiler :if / :else-if / :else", () => {
  it("emits button with click event from :if cluster", () => {
    const sfc = `
<template>
  <div>
    <template :if="ok">
      <button @click="doClick()">Yes</button>
    </template>
    <template :else-if="maybe">
      <span>No</span>
    </template>
    <template :else>
      <p>Else</p>
    </template>
  </div>
</template>
<script>
function doClick(){ console.log("clicked") }
let ok = true
let maybe = false
</script>
`;

    const { code } = compileSFC(sfc, "/virtual/IfElseTest.marwa");

    // ---- Assertions ----
    expect(code.includes(`Dom.createElement("button")`)).toBe(true);
    expect(code.includes(`"click"`)).toBe(true);
    expect(code.includes(`bindIf`)).toBe(true);

    // Optional deeper checks
    expect(code).toMatch(/doClick\(\)/);
    expect(code).toMatch(/Yes/);
    expect(code).toMatch(/No/);
    //expect(code).toMatch(/Else/);
  });
});
