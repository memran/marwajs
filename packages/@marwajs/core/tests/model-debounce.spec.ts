import { describe, it, expect } from "vitest";
import {
  defineComponent,
  createApp,
  Dom,
  bindModel,
  bindText,
  signal,
  nextTick,
} from "@marwajs/core";

describe("m-model debounce", () => {
  it("delays updates on input/textarea", async () => {
    const host = document.createElement("div");
    const app = createApp(host);

    const C = defineComponent((_p, _ctx) => {
      const v = signal("");
      const i = Dom.createElement("input") as HTMLInputElement;
      const t = Dom.createText("");

      const stopB = bindModel(
        app as any,
        i,
        () => v(),
        (x) => v.set(x),
        { debounce: 120 }
      );
      const stopT = bindText(t, () => `v=${v()}`);

      return {
        mount(el: Node) {
          Dom.insert(i, el);
          Dom.insert(t, el);
        },
        destroy() {
          stopB();
          stopT();
          Dom.remove(i);
          Dom.remove(t);
        },
      };
    });

    const c = C({}, { app });
    c.mount(host);

    const input = host.querySelector("input")!;
    input.value = "A";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    expect(host.textContent).toContain("v="); // still empty during debounce

    await new Promise((r) => setTimeout(r, 140));
    await nextTick();
    expect(host.textContent).toContain("v=A");
  });
});
