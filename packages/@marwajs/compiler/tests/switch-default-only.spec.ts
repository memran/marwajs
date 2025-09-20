// tests/switch-default-only.spec.ts
import { describe, it, expect } from "vitest";
import { createApp, nextTick } from "@marwajs/core";
import { compileSFC } from "../src/sfc/compileSFC";
import { evalCompiled } from "./test-utils";

describe("compiler :switch default behavior", () => {
  it("falls back to :default when no case matches, and switches reactively", async () => {
    const sfc = `
  <template>
    <div>
      <template :switch="n()"></template>
      <template :case="1"><span>one</span></template>
      <template :default><span>other</span></template>
      <button @click="n.set(n()+1)">inc</button>
    </div>
  </template>
  <script lang="ts">
    import { signal } from '@marwajs/core';
    const n = signal(0);
  </script>`.trim();

    const { code } = compileSFC(sfc, "/virtual/SwitchDefault.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    const app = createApp(host);
    const inst = Comp({}, { app });
    inst.mount(host);
    await nextTick();

    // n=0 → default
    expect(host.textContent).toContain("other");
    expect(host.querySelectorAll("span").length).toBe(1);

    // n=1 → case 1
    host.querySelector("button")!.click();
    await nextTick();
    expect(host.textContent).toContain("one");
    expect(host.querySelectorAll("span").length).toBe(1);

    // n=2 → back to default
    host.querySelector("button")!.click();
    await nextTick();
    expect(host.textContent).toContain("other");
    expect(host.querySelectorAll("span").length).toBe(1);

    inst.destroy();
  });
});
