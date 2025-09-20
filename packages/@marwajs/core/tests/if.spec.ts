import { describe, it, expect } from "vitest";
import { signal, nextTick } from "../src";
import { Dom, bindText, bindIf } from "../src";

function textBlock(expr: () => string) {
  const el = Dom.createElement("p");
  const tn = Dom.createText("");
  Dom.insert(tn, el);
  const off = bindText(tn, expr);
  return {
    el,
    mount(parent: Node, anchor?: Node | null) {
      Dom.insert(el, parent, anchor ?? null);
    },
    destroy() {
      off();
      Dom.remove(el);
    },
  };
}

describe(":if", () => {
  it("mounts/unmounts then/else", async () => {
    const host = document.createElement("div");
    const on = signal(false);

    const stop = bindIf(
      host,
      () => on(),
      () => textBlock(() => "then"),
      () => textBlock(() => "else")
    );

    expect(host.textContent).toBe("else");

    on.set(true);
    await nextTick();
    expect(host.textContent).toBe("then");

    on.set(false);
    await nextTick();
    expect(host.textContent).toBe("else");

    stop();
    expect(host.textContent).toBe("");
  });
});
