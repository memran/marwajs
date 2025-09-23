// tests/child-nested.spec.ts
import { describe, it, expect } from "vitest";
import { createApp, nextTick } from "@marwajs/core";
import { compileSFC } from "../src/sfc/compileSFC";
import { evalCompiled } from "./test-utils";

describe("@marwajs/compiler child mounting (nested)", () => {
  it("mounts Child into #slot and GrandChild into Child's #child-slot", async () => {
    const sfc = `
<template>
  <div>
    <h1>Parent</h1>
    <div id="slot"></div>
  </div>
</template>
<script>
import { onMount } from '@marwajs/core';

// NOTE: We intentionally reference Dom/bindText without importing here.
// Your codegen scans prelude and imports helpers automatically.

const GrandChild = defineComponent((props, ctx) => {
  const root = Dom.createElement('i');
  const tn = Dom.createText('grand');
  return {
    mount(target) {
      Dom.insert(root, target, null);
      Dom.insert(tn, root, null);
    }
  };
});

const Child = defineComponent((props, ctx) => {
  const root = Dom.createElement('span');
  const label = Dom.createText('child');
  const slot = Dom.createElement('div');
  Dom.setAttr(slot, 'id', 'child-slot');
  return {
    mount(target) {
      Dom.insert(root, target, null);
      Dom.insert(label, root, null);
      Dom.insert(slot, root, null);
      // mount GrandChild inside Child
      const gc = GrandChild({}, { app: ctx.app });
      gc.mount(slot);
    }
  };
});

onMount(() => {
  const host = (typeof document !== 'undefined') && document.getElementById('slot');
  if (host) {
    console.log('Mounting child');
    const inst = Child({}, { app: ctx.app });
    inst.mount(host);
  }
});
</script>
`.trim();

    const { code } = compileSFC(sfc, "/virtual/ChildNested.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    document.body.appendChild(host);

    const app = createApp(host);
    const inst = Comp({}, { app });

    inst.mount(host);
    await nextTick();

    // Parent rendered
    expect(host.textContent).toContain("Parent");
    // Child mounted into #slot
    const child = host.querySelector("#slot span") as HTMLSpanElement;
    expect(child).toBeTruthy();
    expect(child.textContent).toContain("child");
    // GrandChild mounted inside Child's slot
    const gc = host.querySelector("#slot span #child-slot i") as HTMLElement;
    expect(gc).toBeTruthy();
    expect(gc.textContent).toContain("grand");

    inst.destroy();
  });
});
