import { describe, it, expect } from "vitest";
import { createApp, Dom, signal, nextTick, bindIf } from "@marwajs/core";

describe("runtime bindIf with else", () => {
  it("switches between :if and :else", async () => {
    const host = document.createElement("div");
    const app = createApp(host);

    const cond = signal(true);

    const stop = bindIf(
      host,
      () => cond(),
      () => {
        const el = Dom.createElement("p");
        el.textContent = "IF";
        return {
          el,
          mount(parent, anchor) {
            Dom.insert(el, parent, anchor);
          },
          destroy() {
            Dom.remove(el);
          },
        };
      },
      () => {
        const el = Dom.createElement("p");
        el.textContent = "ELSE";
        return {
          el,
          mount(parent, anchor) {
            Dom.insert(el, parent, anchor);
          },
          destroy() {
            Dom.remove(el);
          },
        };
      }
    );

    expect(host.textContent).toBe("IF");

    cond.set(false);
    await nextTick();
    expect(host.textContent).toBe("ELSE");

    cond.set(true);
    await nextTick();
    expect(host.textContent).toBe("IF");

    stop();
  });
});
