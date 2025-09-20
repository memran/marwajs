// tests/switch-strict-eq.spec.ts
import { describe, it, expect } from "vitest";
import { createApp, nextTick } from "@marwajs/core";
import { compileSFC } from "../src/sfc/compileSFC";
import { evalCompiled } from "./test-utils";

describe(":switch uses strict === equality", () => {
  it("does not match '1' (string) to 1 (number)", async () => {
    const sfc = `
  <template>
    <div>
      <template :switch="val()"></template>
      <template :case="1"><span>num-one</span></template>
      <template :case="'1'"><span>str-one</span></template>
    </div>
  </template>
  <script lang="ts">
    import { signal } from '@marwajs/core';
    const val = signal(1);
  </script>`.trim();

    const { code } = compileSFC(sfc, "/virtual/SwitchStrict.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    const app = createApp(host);
    const inst = Comp({}, { app });
    inst.mount(host);
    await nextTick();

    expect(host.textContent).toContain("num-one");
    expect(host.textContent).not.toContain("str-one");

    inst.destroy();
  });
});
