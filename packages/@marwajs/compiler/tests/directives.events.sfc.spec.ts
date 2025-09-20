import { describe, it, expect } from "vitest";
import { compileSFC } from "../src/sfc/compileSFC";
import { createApp, nextTick } from "@marwajs/core";
import { evalCompiled } from "./test-utils";

describe("SFC @event directive", () => {
  it("handles @click and @click.prevent from compiled SFC", async () => {
    const sfc = `
<template>
  <div>
    <p id="v">v={{ n() }}</p>
    <button id="plain" @click="n.set(n() + 1)">inc</button>
    <button id="prevent" @click.prevent="n.set(n() + 1)">inc+prevent</button>
  </div>
</template>
<script lang="ts">
  import { signal } from '@marwajs/core'
  const n = signal(0)
</script>`.trim();

    const { code } = compileSFC(sfc, "/virtual/EventsSFC.marwa");
    // optional debug:
    // console.log(code);

    const Comp = await evalCompiled(code);
    const host = document.createElement("div");
    const app = createApp(host);

    const inst = Comp({}, { app });
    inst.mount(host);
    await nextTick();

    const para = host.querySelector("#v")!;
    const btn1 = host.querySelector("#plain") as HTMLButtonElement | null;
    const btn2 = host.querySelector("#prevent") as HTMLButtonElement | null;

    expect(btn1).toBeTruthy();
    expect(btn2).toBeTruthy();
    expect(para.textContent).toContain("v=0");

    btn1!.click();
    await nextTick();
    expect(para.textContent).toContain("v=1");

    // Click the .prevent one; default should be prevented (internally) and state updates:
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    const beforeDefault = ev.defaultPrevented;
    btn2!.dispatchEvent(ev);
    const afterDefault = ev.defaultPrevented;

    await nextTick();
    expect(para.textContent).toContain("v=2");
    expect(beforeDefault).toBe(false);
    expect(afterDefault).toBe(true);

    inst.destroy();
  });

  it("handles keymod: @keydown.enter", async () => {
    const sfc = `
<template>
  <div>
    <p id="v">v={{ hits() }}</p>
    <input id="inp" @keydown.enter="hits.set(hits() + 1)"/>
  </div>
</template>
<script lang="ts">
  import { signal } from '@marwajs/core'
  const hits = signal(0)
</script>`.trim();

    const { code } = compileSFC(sfc, "/virtual/KeyMods.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    const app = createApp(host);

    const inst = Comp({}, { app });
    inst.mount(host);
    await nextTick();

    const para = host.querySelector("#v")!;
    const inp = host.querySelector("#inp")!;

    expect(para.textContent).toContain("v=0");

    // Wrong key -> no change
    inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true })
    );
    await nextTick();
    expect(para.textContent).toContain("v=0");

    // Enter -> hit
    inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
    await nextTick();
    expect(para.textContent).toContain("v=1");

    inst.destroy();
  });
});
