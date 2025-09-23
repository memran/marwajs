// tests/emit-and-reactive-props.spec.ts
import { describe, it, expect } from "vitest";
import { createApp, nextTick } from "@marwajs/core";
import { compileSFC } from "../src/sfc/compileSFC";
import { evalCompiled } from "./test-utils";

describe("@marwajs/compiler :mount events & reactive props", () => {
  it("child emit → parent handler via @save", async () => {
    const sfc = `
<template>
  <div>
    <template :mount="Child" @save="onSave($event)"></template>
    <div id="result">{{ result() }}</div>
  </div>
</template>
<script>
import { signal } from '@marwajs/core';

const result = signal("none");
function onSave(v) { result.set(v); }

const Child = defineComponent((props, ctx) => {
  const btn = Dom.createElement("button");
  Dom.setAttr(btn, "id", "btn");
  btn.textContent = "ClickMe";
  return {
    mount(target) {
      Dom.insert(btn, target, null);
      btn.addEventListener("click", () => { props.onSave && props.onSave("saved!"); });
    }
  };
});
</script>
`.trim();

    const { code } = compileSFC(sfc, "/virtual/EmitDemo.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    const app = createApp(host);
    const inst = Comp({}, { app });

    inst.mount(host);
    await nextTick();

    const resultDiv = host.querySelector("#result") as HTMLDivElement;
    expect(resultDiv.textContent).toContain("none");

    (host.querySelector("#btn") as HTMLButtonElement).click();
    await nextTick();
    expect(resultDiv.textContent).toContain("saved!");

    inst.destroy();
  });

  it("parent → child reactive props (signals) trigger child.patch and update DOM", async () => {
    const sfc = `
<template>
  <div>
    <template :mount="Child" :msg="title()" :count="n()"></template>
    <button id="t" @click="title.set(title() + '!')">title+</button>
    <button id="n" @click="n.set(n()+1)">n+</button>
  </div>
</template>
<script>
import { signal } from '@marwajs/core';

const title = signal("hello");
const n = signal(1);

const Child = defineComponent((props, ctx) => {
  // local rebindable props + a version signal to force reactive re-eval
  let p = props;
  const version = signal(0);

  const root = Dom.createElement("span");
  const tn = Dom.createText("");

  return {
    mount(target) {
      Dom.insert(root, target, null);
      Dom.insert(tn, root, null);
      // depend on version() so updating it in patch() reruns this binding
      bindText(tn, () => (version(), p.msg + " " + p.count));
    },
    patch(next) {
      p = Object.assign({}, p, next);
      version.set(version() + 1); // trigger re-evaluation
    }
  };
});
</script>
`.trim();

    const { code } = compileSFC(sfc, "/virtual/ReactivePropsDemo.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    const app = createApp(host);
    const inst = Comp({}, { app });

    inst.mount(host);
    await nextTick();

    const span = host.querySelector("span") as HTMLSpanElement;
    expect(span.textContent).toContain("hello 1");

    // Update title signal in parent → compiler recomputes props → child.patch → DOM updates
    (host.querySelector("#t") as HTMLButtonElement).click();
    await nextTick();
    expect(span.textContent).toContain("hello! 1");

    // Update count signal
    (host.querySelector("#n") as HTMLButtonElement).click();
    await nextTick();
    expect(span.textContent).toContain("hello! 2");

    inst.destroy();
  });
});
