// tests/if-else-reactive.spec.ts
import { describe, it, expect } from "vitest";
import { createApp, Dom, nextTick } from "@marwajs/core";
import { compileSFC } from "../src/sfc/compileSFC";
import { evalCompiled } from "./test-utils";

const sfcSource = `
<template>
  <div>
    <template :if="show()">
      <p>ON</p>
    </template>
    <template :else>
      <p>OFF</p>
    </template>
    <button @click="toggle()">Toggle Light</button>
  </div>
</template>
<script>
  import { signal } from '@marwajs/core'
  const show = signal(true)
  function toggle(){ show.set(!show()) }
</script>
`;

describe("compiler :if / :else reactive", () => {
  it("renders ON, toggles to OFF on click, then back to ON", async () => {
    const { code } = compileSFC(sfcSource, "/virtual/IfElseToggle.marwa");
    const Comp = await evalCompiled(code); // default export = defineComponent(...)
    const host = Dom.createElement("div");
    const app = createApp(host);
    // ✅ your runtime: call component factory with ctx { app } and mount manually
    const inst = Comp({}, { app });
    inst.mount(host);
    // Initial: ON exists, OFF doesn't
    expect(host.textContent).toContain("ON");
    expect(host.textContent).not.toContain("OFF");
    // Click -> OFF
    host.querySelector("button")!.click();
    await nextTick();
    expect(host.textContent).toContain("OFF");
    expect(host.textContent).not.toContain("ON");
    //Click -> ON
    host.querySelector("button")!.click();
    await nextTick();
    expect(host.innerHTML).toContain("ON");
    expect(host.innerHTML).not.toContain("OFF");

    inst.destroy?.();
  });
});
