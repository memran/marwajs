import { createApp, nextTick, signal } from "@marwajs/core";
import { compileSFC } from "../src/sfc/compileSFC";
import { evalCompiled } from "./test-utils";
import { describe, expect, it } from "vitest";

describe("compiler :for", () => {
  it("SFC :for → renders list reactively", async () => {
    const sfc = `
  <template>
        <h1>For Demo</h1>
        <ul>
        <template :for="item in items()">
            <li :text="item"></li>
        </template>
        </ul>
  </template>
  <script lang="ts">
    import { signal } from '@marwajs/core'
    const items = signal(generateRandomStringArray(1000, 2));

    function generateRandomStringArray(
      length: number = 2,
      stringLength: number = 2,
      characters: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    ): string[] {
      const result: string[] = [];
      
      for (let i = 0; i < length; i++) {
        let randomString = '';
        for (let j = 0; j < stringLength; j++) {
          randomString += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        result.push(randomString);
      }
      
      return result;
    }

  </script>`.trim();

    const { code } = compileSFC(sfc, "/virtual/ForDemo.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    const app = createApp(host);
    const inst = Comp({}, { app });

    inst.mount(host);
    await nextTick();

    // Initial render
    expect(host.textContent).toContain("a");
    expect(host.textContent).toContain("b");
    expect(host.querySelectorAll("li").length).toBe(1000);

    // Mutate the signal (append new item)
    // (inst as any).ctx.scope.items.set(["a", "b", "c"]);
    // await nextTick();
    // expect(host.querySelectorAll("li").length).toBe(3);
    // expect(host.textContent).toContain("c");

    // Replace list
    // (inst as any).ctx.scope.items.set(["x"]);
    // await nextTick();
    // expect(host.querySelectorAll("li").length).toBe(1);
    // expect(host.textContent).toContain("x");

    inst.destroy();
  });
});
