import { describe, it, expect } from "vitest";
import { createApp, Dom, nextTick } from "@marwajs/core";
import { signal } from "@marwajs/core";
import { bindSwitch } from "@marwajs/core";

const mk = (txt: string) => () => {
  const t = Dom.createText(txt);
  return {
    el: t,
    mount(p: Node, a?: Node | null) {
      Dom.insert(t, p, a ?? null);
    },
    destroy() {
      Dom.remove(t);
    },
  };
};

it("bindSwitch reacts across else-if chain", async () => {
  const host = document.createElement("div");
  const app = createApp(host);
  const n = signal(0);

  const parent = host;
  const stop = bindSwitch(
    parent,
    [
      { when: () => n() === 0, factory: mk("zero") },
      { when: () => n() === 1, factory: mk("one") },
      { when: () => n() === 2, factory: mk("two") },
    ],
    mk("other")
  );

  await nextTick();
  expect(host.textContent).toBe("zero");

  n.set(1);
  await nextTick();
  expect(host.textContent).toBe("one");

  n.set(2);
  await nextTick();
  expect(host.textContent).toBe("two");

  n.set(5);
  await nextTick();
  expect(host.textContent).toBe("other");

  stop();
});
