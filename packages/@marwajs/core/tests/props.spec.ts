import { describe, it, expect } from "vitest";
import {
  defineComponent,
  createApp,
  Dom,
  bindText,
  nextTick,
  signal,
} from "@marwajs/core";

describe("component props", () => {
  it("passes static props to child", async () => {
    const host = document.createElement("div");
    const app = createApp(host);

    const Child = defineComponent((props) => {
      const t = Dom.createText("");
      // support both static string and signal prop
      const readTitle = () =>
        typeof props.title === "function"
          ? (props.title as any)()
          : props.title;

      const stop = bindText(t, () => `child:${readTitle()}`);

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

    const Parent = defineComponent((_p, ctx) => {
      const root = Dom.createElement("div");
      const child = Child({ title: "hello" }, ctx);

      return {
        mount(el: Node) {
          Dom.insert(root, el);
          child.mount(root);
        },
        destroy() {
          child.destroy();
          Dom.remove(root);
        },
      };
    });

    const p = Parent({}, { app });
    p.mount(host);
    await nextTick();

    expect(host.textContent).toContain("child:hello");

    p.destroy();
  });

  it("passes a signal prop and child updates reactively when the signal changes", async () => {
    const host = document.createElement("div");
    const app = createApp(host);

    const Child = defineComponent((props) => {
      const t = Dom.createText("");
      // here we expect a signal prop; still defensive for static fallback
      const readTitle = () =>
        typeof props.title === "function"
          ? (props.title as any)()
          : props.title;

      const stop = bindText(t, () => `child:${readTitle()}`);

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

    const Parent = defineComponent((_p, ctx) => {
      const title = signal("A");
      const root = Dom.createElement("div");
      const child = Child({ title }, ctx);

      // expose signal for test driving updates
      (Parent as any)._title = title;

      return {
        mount(el: Node) {
          Dom.insert(root, el);
          child.mount(root);
        },
        destroy() {
          child.destroy();
          Dom.remove(root);
        },
      };
    });

    const p = Parent({}, { app });
    p.mount(host);
    await nextTick();

    expect(host.textContent).toContain("child:A");

    // update the parent's signal → child should reflect new value
    const titleSig = (Parent as any)._title as ReturnType<typeof signal>;
    titleSig.set("B");
    await nextTick();
    expect(host.textContent).toContain("child:B");

    p.destroy();
  });
});
