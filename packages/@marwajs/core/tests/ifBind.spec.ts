import { describe, it, expect } from "vitest";
import { createApp, Dom, signal, nextTick, bindIf } from "@marwajs/core";

describe("runtime bindIf", () => {
  it("handles simple :if toggling", async () => {
    const host = document.createElement("div");
    createApp(host);

    const show = signal(false);

    const stop = bindIf(
      host,
      () => show(),
      () => {
        const el = Dom.createElement("p");
        el.textContent = "Hello";
        return {
          el,
          mount(parent, anchor) {
            Dom.insert(el, parent, anchor ?? null);
          },
          destroy() {
            Dom.remove(el);
          },
        };
      }
    );

    expect(host.textContent).toBe("");

    show.set(true);
    await nextTick();
    expect(host.textContent).toBe("Hello");

    show.set(false);
    await nextTick();
    expect(host.textContent).toBe("");

    stop();
  });
});
