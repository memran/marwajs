// tests/provide-inject-nested.spec.ts
import { describe, it, expect } from "vitest";
import { createApp, nextTick } from "@marwajs/core";
import { compileSFC } from "../src/sfc/compileSFC";
import { evalCompiled } from "./test-utils";

describe("@marwajs/compiler provide/inject (nested override)", () => {
  it("closest provider wins and updates reactively", async () => {
    const sfc = `
<template>
  <div>
    <div id="slot"></div>
    <button id="outer" @click="outerVal.set('outer-2')">outer</button>
  </div>
</template>
<script>
import { signal, provide, inject, onMount } from '@marwajs/core';

const KEY = 'k';
const outerVal = signal('outer-1');
provide(KEY, outerVal);

const Child = defineComponent((props, ctx) => {
  const innerVal = signal('inner-1');
  provide(KEY, innerVal);
  const root = Dom.createElement('div');
  const text = Dom.createText('');
  const btn = Dom.createElement('button');
  Dom.setAttr(btn, 'id', 'inner');
  btn.addEventListener('click', () => innerVal.set('inner-2'));
  return {
    mount(target) {
      Dom.insert(root, target, null);
      Dom.insert(text, root, null);
      Dom.insert(btn, root, null);
      const injected = inject(KEY);
      bindText(text, () => injected());
    }
  };
});
 

onMount(() => {
  const host = typeof document !== 'undefined' ? document.getElementById('slot') : null;
  if (host) {
    
    const inst = Child({}, { app: ctx.app });
    inst.mount(host);
  }
});
</script>
`.trim();

    const { code } = compileSFC(sfc, "/virtual/ProvideNested.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    document.body.appendChild(host); // ensure document.getElementById works
    const app = createApp(host);
    const inst = Comp({}, { app });
    inst.mount(host);
    await nextTick();

    // Child starts with inner-1 (child override visible)
    expect(host.textContent).toContain("inner-1");

    // Change outer provider -> child should stay at inner-1
    (host.querySelector("#outer") as HTMLButtonElement).click();
    await nextTick();
    expect(host.textContent).toContain("inner-1");

    // Change inner provider via child's hidden button -> child updates to inner-2
    (host.querySelector("#inner") as HTMLButtonElement).click();
    await nextTick();
    expect(host.textContent).toContain("inner-2");

    inst.destroy();
  });
});
