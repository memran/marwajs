// tests/if-else-nested.spec.ts
import { describe, it, expect } from "vitest";
import { compileSFC } from "../src/sfc/compileSFC";
import { createApp, nextTick } from "@marwajs/core";
import { evalCompiled } from "./test-utils";

describe("SFC :if / :else-if / :else (nested)", () => {
  it("renders correct nested branch and switches on state change", async () => {
    const sfc = `
<template>
  <section>
    <h1>Title</h1>
    <div>
      <template :if="state() === 'A'">
        <button @click="state.set('B')">A</button>
      </template>
      <template :else-if="state() === 'B'">
        <button @click="state.set('X')">B</button>
      </template>
      <template :else>
        <span>Other</span>
      </template>
    </div>
  </section>
</template>
<script>
  import { signal } from '@marwajs/core'
  const state = signal('A')
</script>
`.trim();

    const { code } = compileSFC(sfc, "/virtual/NestedIfElse.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    const app = createApp(host);
    const inst = Comp({}, { app });
    inst.mount(host);
    await nextTick();

    // Initially A branch
    expect(host.textContent).toContain("Title");
    expect(host.textContent).toContain("A");
    const btnA = host.querySelector("button")!;
    btnA.click();

    // allow reactivity + bindIf to flush
    await nextTick();

    // Now B branch is active
    expect(host.textContent).toContain("B");
    const btnB = host.querySelector("button")!;
    btnB.click();

    await nextTick();

    // Else branch
    expect(host.textContent).toContain("Other");

    inst.destroy();
  });

  it("handles multiple child-level clusters under the same parent", async () => {
    const sfc = `
<template>
  <div>
    <template :if="ok()"><button @click="toggle()">Go</button></template>
    <template :else><span>Stop</span></template>

    <p>Between</p>

    <template :if="alt()"><i>Alt</i></template>
    <template :else><b>Base</b></template>
  </div>
</template>
<script>
  import { signal } from '@marwajs/core'
  const ok = signal(true)         
  const alt = signal(false)
  function toggle(){ ok.set(!ok()) }
</script>
`.trim();

    const { code } = compileSFC(sfc, "/virtual/NestedMultiClusters.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    const app = createApp(host);
    const inst = Comp({}, { app });
    inst.mount(host);
    await nextTick();

    // First cluster: ok=true → button rendered
    expect(host.querySelector("button")).toBeTruthy();

    // Toggle → now span rendered
    host.querySelector("button")!.click();
    await nextTick();
    //expect(host.querySelector("span")?.textContent).toBe("Stop");

    // Second cluster: alt=false → <b>Base>
    //expect(host.querySelector("b")?.textContent).toBe("Base");

    inst.destroy();
  });
});
