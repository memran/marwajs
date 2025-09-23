// tests/child-props-and-signal.spec.ts
import { describe, it, expect } from "vitest";
import { createApp, nextTick, signal } from "@marwajs/core";
import { compileSFC } from "../src/sfc/compileSFC";
import { evalCompiled } from "./test-utils";

describe("@marwajs/compiler child component (props & signal)", () => {
  it("mounts Child into #slot and renders props value", async () => {
    const sfc = `
<template>
  <div>
    <h1>Parent</h1>
    <div id="slot"></div>
  </div>
</template>
<script>
import { onMount } from '@marwajs/core';

const Child = defineComponent((props, ctx) => {
  const root = Dom.createElement('span');
  const tn = Dom.createText('');
  return {
    mount(target) {
      Dom.insert(root, target, null);
      Dom.insert(tn, root, null);
      bindText(tn, () => props.msg);
    }
  };
});

onMount(() => {
  const host = document.getElementById('slot');
  if (host) {
    const inst = Child({ msg: props.msg }, { app: ctx.app });
    inst.mount(host);
  }
});
</script>
`.trim();

    const { code } = compileSFC(sfc, "/virtual/ChildPropsOnly.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    document.body.appendChild(host); // ensure document.getElementById works

    const app = createApp(host);
    const inst = Comp({ msg: "hello" }, { app });

    inst.mount(host);
    await nextTick();

    // Parent rendered
    expect(host.textContent).toContain("Parent");
    // Child shows prop
    const child = host.querySelector("#slot span") as HTMLSpanElement;
    expect(child).not.toBeNull();
    expect(child.textContent).toContain("hello");

    inst.destroy();
    document.body.removeChild(host);
  });

  it("mounts Child and reacts to a signal prop", async () => {
    const sfc = `
<template>
  <div>
    <div id="slot"></div>
  </div>
</template>
<script>
import { onMount } from '@marwajs/core';

const Child = defineComponent((props, ctx) => {
  const root = Dom.createElement('span');
  const tMsg = Dom.createText('');
  const space = Dom.createText(' ');
  const tSig = Dom.createText('');
  return {
    mount(target) {
      Dom.insert(root, target, null);
      Dom.insert(tMsg, root, null);
      Dom.insert(space, root, null);
      Dom.insert(tSig, root, null);
      bindText(tMsg, () => props.msg);
      bindText(tSig, () => props.s());
    }
  };
});

onMount(() => {
  const host = document.getElementById('slot');
  if (host) {
    const inst = Child({ msg: props.msg, s: props.s }, { app: ctx.app });
    inst.mount(host);
  }
});
</script>
`.trim();

    const { code } = compileSFC(sfc, "/virtual/ChildSignalProp.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    document.body.appendChild(host);

    const app = createApp(host);
    const s = signal("A");
    const inst = Comp({ msg: "hello", s }, { app });

    inst.mount(host);
    await nextTick();

    const child = host.querySelector("#slot span") as HTMLSpanElement;
    expect(child).not.toBeNull();
    expect(child.textContent).toContain("hello A");

    // update signal from the test, child should react
    s.set("B");
    await nextTick();
    expect(child.textContent).toContain("hello B");

    inst.destroy();
    document.body.removeChild(host);
  });
});
