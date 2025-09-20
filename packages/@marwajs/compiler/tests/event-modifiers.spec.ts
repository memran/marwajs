// tests/event-modifiers.spec.ts
import { describe, it, expect } from "vitest";
import { compileSFC } from "../src/sfc/compileSFC";

describe("event modifiers", () => {
  it("@click.prevent pulls withModifiers and onEvent", () => {
    const sfc = `
<template>
  <button @click.prevent="count.set(count()+1)">Inc</button>
</template>
<script>
  import { signal } from '@marwajs/core'
  const count = signal(0)
</script>`.trim();

    const { code } = compileSFC(sfc, "/virtual/EventMods.marwa");
    expect(code.includes(`withModifiers`)).toBe(true);
    expect(code.includes(`onEvent`)).toBe(true);
    expect(code.includes(`"click"`)).toBe(true);
  });
});
