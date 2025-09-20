import { describe, it, expect } from "vitest";
import { createApp, Dom, signal, nextTick, bindIf } from "@marwajs/core";

describe("runtime bindIf nested", () => {
  it("handles nested if inside another", async () => {
    const host = document.createElement("div");
    const app = createApp(host);

    const outer = signal(true);
    const inner = signal(false);

    const stop = bindIf(
      host,
      () => outer(),
      () => {
        const outerDiv = Dom.createElement("div");
        outerDiv.textContent = "OUTER";

        // mount nested if
        const innerStop = bindIf(
          outerDiv,
          () => inner(),
          () => {
            const el = Dom.createElement("span");
            el.textContent = "INNER";
            return {
              el,
              mount(p, a) {
                Dom.insert(el, p, a);
              },
              destroy() {
                Dom.remove(el);
              },
            };
          }
        );

        return {
          el: outerDiv,
          mount(p, a) {
            Dom.insert(outerDiv, p, a);
          },
          destroy() {
            Dom.remove(outerDiv);
            innerStop();
          },
        };
      }
    );

    expect(host.textContent).toBe("OUTER");

    inner.set(true);
    await nextTick();
    expect(host.textContent).toContain("INNER");

    outer.set(false);
    await nextTick();
    expect(host.textContent).toBe("");

    stop();
  });
});
