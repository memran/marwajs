import { describe, it, expect } from "vitest";
import {
  defineComponent,
  createApp,
  Dom,
  bindText,
  nextTick,
  signal,
  provide,
  inject,
} from "@marwajs/core";

describe("provide/inject", () => {
  it("uses root provider when no nearer provider exists (and updates reactively)", async () => {
    const KEY = "theme";
    const host = document.createElement("div");
    const app = createApp(host);

    const Leaf = defineComponent((_p, _ctx) => {
      const theme = inject(KEY, signal("light")); // default only if no provider
      if (theme === undefined) throw new Error("theme is undefined");
      const t = Dom.createText("");
      const stop = bindText(t, () => `leaf:${theme()}`);
      return {
        mount(el: Node) {
          Dom.insert(t, el);
        },
        destroy() {
          stop();
          Dom.remove(t);
        },
      };
    });

    const Middle = defineComponent((_p, ctx) => {
      // NOTE: Middle does NOT provide; should inherit from Root
      const box = Dom.createElement("div");
      const leaf = Leaf({}, ctx);
      return {
        mount(el: Node) {
          Dom.insert(box, el);
          leaf.mount(box);
        },
        destroy() {
          if (leaf && typeof leaf.destroy === "function") {
            leaf.destroy();
          }
          Dom.remove(box);
        },
      };
    });

    const Root = defineComponent((_p, ctx) => {
      const theme = signal("blue");
      provide(KEY, theme); // only provider in the tree
      const sec = Dom.createElement("section");
      const mid = Middle({}, ctx);
      (Root as any)._theme = theme; // expose for test
      return {
        mount(el: Node) {
          Dom.insert(sec, el);
          mid.mount(sec);
        },
        destroy() {
          if (mid && typeof mid.destroy === "function") {
            mid.destroy();
          }
          Dom.remove(sec);
        },
      };
    });

    const r = Root({}, { app });
    r.mount(host);
    await nextTick();

    expect(host.textContent).toContain("leaf:blue");

    // update outer provider -> leaf reacts
    const outer = (Root as any)._theme as ReturnType<typeof signal>;
    outer.set("teal");
    await nextTick();
    expect(host.textContent).toContain("leaf:teal");
    if (r && typeof r.destroy === "function") r.destroy();
  });

  it("nearest provider overrides outer provider (and inner updates win)", async () => {
    const KEY = "theme";
    const host = document.createElement("div");
    const app = createApp(host);

    const Leaf = defineComponent((_p, _ctx) => {
      const theme = inject(KEY, signal("light"));
      if (theme === undefined) throw new Error("theme is undefined");
      const t = Dom.createText("");
      const stop = bindText(t, () => `leaf:${theme()}`);
      return {
        mount(el: Node) {
          Dom.insert(t, el);
        },
        destroy() {
          stop();
          Dom.remove(t);
        },
      };
    });

    const Middle = defineComponent((_p, ctx) => {
      const innerTheme = signal("dark"); // nearer provider
      provide(KEY, innerTheme);
      const box = Dom.createElement("div");
      const leaf = Leaf({}, ctx);
      (Middle as any)._inner = innerTheme; // expose for test
      return {
        mount(el: Node) {
          Dom.insert(box, el);
          leaf.mount(box);
        },
        destroy() {
          if (leaf && typeof leaf.destroy === "function") {
            leaf.destroy();
          }
          Dom.remove(box);
        },
      };
    });

    const Root = defineComponent((_p, ctx) => {
      const outerTheme = signal("blue"); // outer provider
      provide(KEY, outerTheme);
      const sec = Dom.createElement("section");
      const mid = Middle({}, ctx);
      (Root as any)._outer = outerTheme;
      return {
        mount(el: Node) {
          Dom.insert(sec, el);
          mid.mount(sec);
        },
        destroy() {
          if (mid && typeof mid.destroy === "function") {
            mid.destroy();
          }
          Dom.remove(sec);
        },
      };
    });

    const r = Root({}, { app });
    r.mount(host);
    await nextTick();

    // Nearest (Middle: "dark") wins over Root ("blue")
    expect(host.textContent).toContain("leaf:dark");

    // Update inner -> leaf follows inner
    const inner = (Middle as any)._inner as ReturnType<typeof signal>;
    inner.set("indigo");
    await nextTick();
    expect(host.textContent).toContain("leaf:indigo");

    // Update outer -> leaf stays on inner (still nearest)
    const outer = (Root as any)._outer as ReturnType<typeof signal>;
    outer.set("pink");
    await nextTick();
    expect(host.textContent).toContain("leaf:indigo");

    if (r && typeof r.destroy === "function") r.destroy();
  });
});
