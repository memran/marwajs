import { describe, it, expect } from "vitest";
import { createApp, Dom, signal, nextTick, withModifiers } from "@marwajs/core";

describe("@event directive (runtime)", () => {
  it("@click runs handler", async () => {
    const host = document.createElement("div");
    const app = createApp(host);
    const count = signal(0);

    const btn = Dom.createElement("button");
    Dom.setAttr(btn, "id", "btn");
    Dom.insert(btn, host);

    // Wire event via runtime helper so we don't depend on compiler here
    const stop = app.on("click", btn, (e: Event) => {
      count.set(count() + 1);
    });

    // click
    (btn as HTMLButtonElement).click();
    await nextTick();
    expect(count()).toBe(1);

    stop(); // cleanup
  });

  it("@click.prevent uses withModifiers", async () => {
    const host = document.createElement("div");
    const app = createApp(host);

    let prevented = false;
    const btn = Dom.createElement("button");
    Dom.insert(btn, host);

    const handler = withModifiers((e: Event) => {}, ["prevent"]);
    const stop = app.on("click", btn, (e: Event) => {
      handler(e);
      prevented = prevented || e.defaultPrevented === true;
    });

    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    await nextTick();

    expect(prevented).toBe(true);
    stop();
  });

  it("@keydown.enter only fires on Enter", async () => {
    const host = document.createElement("div");
    const app = createApp(host);

    const hits = signal(0);
    const input = Dom.createElement("input");
    Dom.insert(input, host);

    // simulate compiler behavior: key filter + handler
    const handler = (e: KeyboardEvent) => {
      // keymod filter the compiler generates
      if (!["Enter"].includes(e.key)) return;
      hits.set(hits() + 1);
    };
    const stop = app.on("keydown", input, handler as any);

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true })
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
    await nextTick();

    expect(hits()).toBe(1);
    stop();
  });
});
