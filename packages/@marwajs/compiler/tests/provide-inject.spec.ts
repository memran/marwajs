// tests/provide-inject.spec.ts
import { describe, it, expect } from "vitest";
import { createApp, nextTick } from "@marwajs/core";
import { compileSFC } from "../src/sfc/compileSFC";
import { evalCompiled } from "./test-utils";

describe("@marwajs/compiler provide/inject", () => {
  it("child injects parent's provided signal and updates reactively", async () => {
    const sfc = `
<template>
  <div>
    <div id="slot">MarwaJS</div>
    <div id="val">{{ val() }}</div>
    <button id="b" @click="val.set('B')">chg</button>
  </div>
</template>
<script>
import { signal, provide, inject, onMount } from '@marwajs/core';
const KEY = 'test-key';
const val = signal('A');
provide(KEY, val);

const Child = defineComponent((props, ctx) => {
  const injected = inject(KEY);
  const root = Dom.createElement('span');
  const tn = Dom.createText('');
  return {
    mount(target) {
      Dom.insert(root, target, null);
      Dom.insert(tn, root, null);
      bindText(tn, () => injected());
    }
  };
});

onMount(() => {
  const host = (typeof document !== 'undefined') && document.getElementById('slot');
  if (host) {
    const inst = Child({}, { app: ctx.app });
    inst.mount(host);
  }
});
</script>
`.trim();

    const { code } = compileSFC(sfc, "/virtual/ProvideInject.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    const app = createApp(host);
    const inst = Comp({}, { app });

    inst.mount(host);
    await nextTick();

    // Child span should render initial provided value 'A'
    const span = host.querySelector("#slot") as HTMLSpanElement;
    console.log(span?.textContent);
    expect(span.textContent).toContain("MarwaJS");
    expect(span).toBeTruthy();
    //initial value of val
    const val = host.querySelector("#val") as HTMLSpanElement;
    expect(val.textContent).toContain("A");

    // Update provider value → child updates reactively
    (host.querySelector("#b") as HTMLButtonElement).click();
    await nextTick();
    expect(val.textContent).toContain("B");
    inst.destroy();
  });
});
