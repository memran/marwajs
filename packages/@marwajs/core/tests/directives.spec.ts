import { describe, it, expect } from "vitest";
import {
  ref,
  reactive,
  computed,
  nextTick,
  createApp,
  Dom,
  bindText,
  bindShow,
  bindClass,
  bindStyle,
  bindHTML,
  bindModel,
} from "../src";

describe("directive helpers", () => {
  it(":text updates text nodes", async () => {
    const host = document.createElement("div");
    const app = createApp(host);
    const t = Dom.createText("");
    Dom.insert(t, host);

    const n = ref(1);
    const stop = bindText(t, () => `n=${n.value}`);

    expect(host.textContent).toBe("n=1");
    n.value = 5;
    await nextTick();
    expect(host.textContent).toBe("n=5");

    stop();
  });

  it(":show toggles hidden attr", async () => {
    const host = document.createElement("div");
    const app = createApp(host);
    const el = Dom.createElement("div");
    Dom.insert(el, host);

    const visible = ref(false);
    const off = bindShow(el, () => visible.value);

    expect(el.hasAttribute("hidden")).toBe(true);
    visible.value = true;
    await nextTick();
    expect(el.hasAttribute("hidden")).toBe(false);
    off();
  });

  it(":class and :style apply changes", async () => {
    const host = document.createElement("div");
    const app = createApp(host);
    const el = Dom.createElement("div");
    Dom.insert(el, host);

    const active = ref(false);
    const color = ref("red");

    const offC = bindClass(el, () => ({ active: active.value, base: true }));
    const offS = bindStyle(el, () => ({ color: color.value }));

    expect(el.className).toBe("base");
    active.value = true;
    color.value = "blue";
    await nextTick();
    expect(el.className.includes("active")).toBe(true);
    expect(el.style.color).toBe("blue");

    offC();
    offS();
  });

  it(":html sets innerHTML (no sanitizer)", async () => {
    const host = document.createElement("div");
    const app = createApp(host);
    const el = Dom.createElement("div");
    Dom.insert(el, host);

    const name = ref("Marwa");
    const off = bindHTML(el, () => `<b>${name.value}</b>`);

    expect(el.innerHTML).toBe("<b>Marwa</b>");
    name.value = "JS";
    await nextTick();
    expect(el.innerHTML).toBe("<b>JS</b>");
    off();
  });

  it("m-model syncs input <-> ref", async () => {
    const host = document.createElement("div");
    const app = createApp(host);

    const input = Dom.createElement("input") as HTMLInputElement;
    Dom.insert(input, host);

    const val = ref("a");
    const off = bindModel(
      app,
      input,
      () => val.value,
      (v) => {
        val.value = v;
      },
      { trim: true }
    );

    // model -> view
    expect(input.value).toBe("a");

    // view -> model
    input.value = "  x  ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    expect(val.value).toBe("x"); // trimmed

    // model -> view again
    val.value = "ok";
    await nextTick();
    expect(input.value).toBe("ok");

    off();
  });

  it("m-model checkbox boolean", async () => {
    const host = document.createElement("div");
    const app = createApp(host);
    const el = Dom.createElement("input") as HTMLInputElement;
    el.type = "checkbox";
    Dom.insert(el, host);

    const checked = ref(false);
    const off = bindModel(
      app,
      el,
      () => checked.value,
      (v) => {
        checked.value = v;
      },
      { type: "checkbox" }
    );

    expect(el.checked).toBe(false);
    el.checked = true;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await nextTick();
    expect(checked.value).toBe(true);

    checked.value = false;
    await nextTick();
    expect(el.checked).toBe(false);

    off();
  });
});
