// tests/emit.spec.ts
import { describe, it, expect } from "vitest";
import { createApp, nextTick } from "@marwajs/core";
import { compileSFC } from "../src/sfc/compileSFC";
import { evalCompiled } from "./test-utils";

describe("@marwajs/compiler emit", () => {
  it("parent listens to child's emitted event via @save", async () => {
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

function onSave(v) {
  result.set(v);
}

const Child = defineComponent((props, ctx) => {
  const root = Dom.createElement("button");
  Dom.setAttr(root, "id", "btn");
  Dom.setAttr(root, "type", "button");
  Dom.setAttr(root, "data-test", "child-btn");
  Dom.setAttr(root, "style", "cursor:pointer");
  root.textContent = "ClickMe";
  return {
    mount(target) {
      Dom.insert(root, target, null);
      // simulate event from inside Child
      root.addEventListener("click", () => {
        props.onSave && props.onSave("saved!");
      });
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

    // Before click: initial result
    const resultDiv = host.querySelector("#result") as HTMLDivElement;
    expect(resultDiv.textContent).toContain("none");

    // Click child button → triggers emit
    const btn = host.querySelector("#btn") as HTMLButtonElement;
    btn.click();
    await nextTick();

    // After click: result updated via onSave handler
    expect(resultDiv.textContent).toContain("saved!");

    inst.destroy();
  });
});
