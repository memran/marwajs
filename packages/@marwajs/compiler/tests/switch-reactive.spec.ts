// tests/switch-reactive.spec.ts
import { describe, it, expect } from "vitest";
import { createApp, nextTick } from "@marwajs/core";
import { compileSFC } from "../src/sfc/compileSFC";
import { evalCompiled } from "./test-utils"; // helper that evals compiled code

describe("compiler :switch / :case / :default", () => {
  it("renders correct case and switches reactively", async () => {
    const sfc = `
  <template>
    <div>
      <template :switch="n()">
        <!-- cases follow -->
      </template>
      <template :case="0">
        <span>zero</span>
      </template>
      <template :case="1">
        <span>one</span>
      </template>
      <template :case="2">
        <span>two</span>
      </template>
      <template :default>
        <span>other</span>
      </template>
      <button @click="n.set(n()+1)">inc</button>
    </div>
  </template>
  <script lang="ts">
    import { signal } from '@marwajs/core'
    const n = signal(0)
  </script>`.trim();

    const { code } = compileSFC(sfc, "/virtual/SwitchDemo.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    const app = createApp(host);

    const inst = Comp({}, { app });
    inst.mount(host);
    await nextTick();

    // initial n=0 → "zero"
    expect(host.textContent).toContain("zero");
    expect(host.querySelectorAll("span").length).toBe(1);

    // click → n=1 → "one"
    host.querySelector("button")!.click();
    await nextTick();
    expect(host.textContent).toContain("one");
    expect(host.querySelectorAll("span").length).toBe(1);

    // click → n=2 → "two"
    host.querySelector("button")!.click();
    await nextTick();
    expect(host.textContent).toContain("two");
    expect(host.querySelectorAll("span").length).toBe(1);

    // click → n=3 → "other"
    host.querySelector("button")!.click();
    await nextTick();
    expect(host.textContent).toContain("other");
    expect(host.querySelectorAll("span").length).toBe(1);

    inst.destroy();
  });
});
