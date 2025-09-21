// tests/switch-nested.spec.ts
import { describe, it, expect } from "vitest";
import { signal, createApp, nextTick } from "@marwajs/core";
import { compileSFC } from "../src/sfc/compileSFC";
import { evalCompiled } from "./test-utils";

describe("compiler nested :switch inside element", () => {
  it("handles nested switch clusters and updates reactively", async () => {
    const sfc = `
  <template>
    <div>
      <p>App</p>
      <template :switch="a()">
      </template>
      <template :case="'x'">
        <template :switch="b()">
        </template>
        <template :case="1"><span>inner-one</span></template>
        <template :default><span>inner-other</span></template>
      </template>
      <template :case="'y'"><span>outer-y</span></template>
      <template :default><span>outer-other</span></template>
      <template :if="n()===100">
        <p>n is 100</p>
      </template>
      <button id="toggleA" @click="a.set(a()==='x'?'y':'x')">toggleA</button>
      <button id="incB" @click="b.set(b()+1)">incB</button>
    </div>
  </template>
  <script lang="ts">
    import { signal } from '@marwajs/core';
    const a = signal('x');
    const b = signal(0);
    const n = props.n;
    // let isLogged:boolean = false;
    // if (!isLogged) { console.log('script run'); isLogged = true; }
  </script>`.trim();

    const { code } = compileSFC(sfc, "/virtual/SwitchNested.marwa");
    const Comp = await evalCompiled(code);
    const n = signal(0);
    const host = document.createElement("div");
    const app = createApp(host);
    const inst = Comp({ n }, { app });
    inst.mount(host);
    await nextTick();

    // outer x + inner default initially
    expect(host.textContent).toContain("inner-other");
    expect(host.querySelectorAll("span").length).toBe(1);

    // inner b=1 → inner-one
    (host.querySelector("#incB") as HTMLButtonElement).click();
    await nextTick();
    expect(host.textContent).toContain("inner-one");
    expect(host.querySelectorAll("span").length).toBe(1);

    // outer a='y' → outer-y (inner switch disappears)
    (host.querySelector("#toggleA") as HTMLButtonElement).click();
    await nextTick();
    expect(host.textContent).toContain("outer-y");
    expect(host.textContent).not.toContain("inner-");
    expect(host.querySelectorAll("span").length).toBe(1);

    // outer a='z' → outer-default
    (host.querySelector("#toggleA") as HTMLButtonElement).click(); // y -> x
    await nextTick();
    (host.querySelector("#toggleA") as HTMLButtonElement).click(); // x -> y
    await nextTick();
    (host.querySelector("#toggleA") as HTMLButtonElement).click(); // y -> x
    await nextTick();
    expect(host.textContent).toContain("inner-one");
    n.set(100); // dummy change to force update
    await nextTick();
    expect(host.textContent).toContain("n is 100");
    //console.log(inst);
    inst.destroy();
  });
});
