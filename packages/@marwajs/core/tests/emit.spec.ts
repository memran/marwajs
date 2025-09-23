import { describe, it, expect } from "vitest";
import { defineComponent, createApp, Dom, onEvent } from "@marwajs/core";

describe("component emit", () => {
  it("child can emit to parent listener", async () => {
    const host = document.createElement("div");
    const app = createApp(host);

    const Child = defineComponent((_props, ctx) => {
      const btn = Dom.createElement("button");
      const off = onEvent(app, btn, "click", () => ctx.emit("save", 42));
      return {
        mount(el: Node) {
          Dom.insert(btn, el);
        },
        destroy() {
          off();
          Dom.remove(btn);
        },
      };
    });

    let received: any = null;

    // Parent wires listener in __listeners (what the compiler will generate)
    const child = Child(
      {
        __listeners: {
          save: (n: number) => {
            received = n;
          },
        },
      } as any,
      { app }
    );
    child.mount(host);

    (host.querySelector("button") as HTMLButtonElement).click();
    expect(received).toBe(42);

    if (child && child.destroy) child.destroy();
  });
});
