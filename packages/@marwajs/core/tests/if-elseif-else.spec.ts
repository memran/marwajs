import { describe, it, expect } from "vitest";
import { createApp, Dom, signal, nextTick, bindIf } from "@marwajs/core";

describe("runtime bindIf with else-if", () => {
  it("switches between multiple branches", async () => {
    const host = document.createElement("div");
    createApp(host);

    const n = signal(0);

    // leaf blocks
    const makeZero = () => {
      const el = Dom.createElement("p");
      el.textContent = "zero";
      return {
        el,
        mount(p, a) {
          Dom.insert(el, p, a ?? null);
        },
        destroy() {
          Dom.remove(el);
        },
      };
    };
    const makeOne = () => {
      const el = Dom.createElement("p");
      el.textContent = "one";
      return {
        el,
        mount(p, a) {
          Dom.insert(el, p, a ?? null);
        },
        destroy() {
          Dom.remove(el);
        },
      };
    };
    const makeMany = () => {
      const el = Dom.createElement("p");
      el.textContent = "many";
      return {
        el,
        mount(p, a) {
          Dom.insert(el, p, a ?? null);
        },
        destroy() {
          Dom.remove(el);
        },
      };
    };

    // else-if block must return a Block, and inside its mount we attach another bindIf
    const makeElseIfBlock = () => {
      const anchor = Dom.createAnchor("elseif");
      let innerStop: (() => void) | null = null;

      return {
        el: anchor,
        mount(parent, anchorNode) {
          Dom.insert(anchor, parent, anchorNode ?? null);
          // second-level condition: n() === 1 ? makeOne : makeMany
          innerStop = bindIf(parent, () => n() === 1, makeOne, makeMany);
        },
        destroy() {
          try {
            innerStop?.();
          } finally {
            Dom.remove(anchor);
          }
        },
      };
    };

    const stop = bindIf(host, () => n() === 0, makeZero, makeElseIfBlock);

    expect(host.textContent).toBe("zero");

    n.set(1);
    await nextTick();
    expect(host.textContent).toBe("one");

    n.set(5);
    await nextTick();
    expect(host.textContent).toBe("many");

    n.set(0);
    await nextTick();
    expect(host.textContent).toBe("zero");

    stop();
  });
});
