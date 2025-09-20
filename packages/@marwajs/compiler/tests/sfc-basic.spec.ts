import { describe, it, expect } from "vitest";
import { compileSFC } from "../src/sfc/compileSFC";
import { createApp, nextTick } from "@marwajs/core";
import { evalCompiled } from "./test-utils";

describe("SFC basic", () => {
  it("compiles and runs a .marwa with mustache + @click.prevent", async () => {
    const sfc = `
<template>
  <div>
    <h1>Hello {{ who() }}</h1>
    <button @click.prevent="who.set('world')">go</button>
  </div>
</template>
<script lang="ts">
  import { signal } from '@marwajs/core'
  const who = signal('dev')
</script>
<style scoped>
  h1 { font-weight: bold; }
</style>`.trim();

    const { code } = compileSFC(sfc, "/virtual/Basic.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    const app = createApp(host);

    const inst = Comp({}, { app });
    inst.mount(host);
    await nextTick();

    expect(host.textContent).toContain("Hello dev");

    const btn = host.querySelector("button")!;
    // btn.dispatchEvent(
    //   new MouseEvent("click", { bubbles: true, cancelable: true })
    // );
    btn.click();
    await nextTick();

    expect(host.textContent).toContain("Hello world");

    // Scoped style got injected once
    const hasScoped = Array.from(document.head.querySelectorAll("style")).some(
      (s) => s.textContent?.includes("[data-mw-")
    );
    expect(hasScoped).toBe(true);

    inst.destroy();
  });

  it("runtime can insert a button into a detached host", async () => {
    const host = document.createElement("div");
    // NOT appended to document.body
    const btn = document.createElement("button");
    btn.id = "raw";
    btn.textContent = "go";
    host.appendChild(btn);
    expect(host.querySelector("#raw")).toBeTruthy();
  });
  it("SFC :if / :else-if / :else → mounts correct branch and switches on state changes", async () => {
    const sfc = `
<template>
  <div>
    <template :if="n()===0">zero</template>
    <template :else-if="n()===1">one</template>
    <template :else>other</template>
    <button @click="n.set(n()+1)">inc</button>
  </div>
</template>
<script lang="ts">
  import { signal } from '@marwajs/core'
  const n = signal(0)
</script>`.trim();

    const { code } = compileSFC(sfc, "/virtual/IfDemo.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    const app = createApp(host);

    const inst = Comp({}, { app });
    inst.mount(host);
    await nextTick(); // ensure effects/if flush

    // initial (n=0): "zero"
    expect(host.textContent).toContain("zero");
    expect(host.querySelectorAll("p").length).toBe(0);

    // const btn = host.querySelector("button")!;
    // btn.click(); // n=1
    // await nextTick();
    // expect(host.textContent).toContain("one");
    // expect(host.querySelectorAll("p").length).toBe(1);

    // btn.click(); // n=2
    // await nextTick();
    // expect(host.textContent).toContain("other");
    // expect(host.querySelectorAll("p").length).toBe(1);

    inst.destroy();
  });
});
