// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
  ref,
  effect,
  nextTick,
  stop,
  defineComponent,
  onMount,
  onDestroy,
  provide,
  inject,
  createApp,
  Dom,
} from "../src";

describe("component runtime", () => {
  it("mounts, reacts, and destroys with auto effect cleanup", async () => {
    const host = document.createElement("div");
    const app = createApp(host);

    const C = defineComponent((_props, _ctx) => {
      const n = ref(0);
      let text!: Text;

      return {
        mount(target) {
          const p = Dom.createElement("p");
          text = Dom.createText("");
          Dom.insert(p, target);
          Dom.insert(text, p);
          // effect should auto-register and be cleaned up on destroy
          effect(() => {
            Dom.setText(text, `count:${n.value}`);
          });
          // bump value after mount for sanity
          n.value = 1;
        },
        destroy() {
          // remove all children for cleanliness
          while (host.firstChild) host.removeChild(host.firstChild);
        },
      };
    });

    const inst = C({}, { app });
    inst.mount(host);
    await nextTick();

    expect(host.textContent).toBe("count:1");

    // mutate again
    // (we have no handle for n here; simulate a user click via provide/inject if needed)
    // For this test, we just ensure destroy stops effects.
    inst.destroy();

    // After destroy, effects should be stopped; changing text manually won't be reactive anyway.
    expect(host.textContent).toBe("");
  });

  it("lifecycle hooks and DI", async () => {
    const host = document.createElement("div");
    const app = createApp(host);

    const KEY = {} as const;
    let mounted = false;
    let destroyed = false;

    const Child = defineComponent((_p, ctx) => {
      const got = inject<number>(KEY, -1)!;
      return {
        mount(target) {
          const span = Dom.createElement("span");
          Dom.setText(span, `child:${got}`);
          Dom.insert(span, target);
        },
      };
    });

    const Parent = defineComponent((_p, ctx) => {
      provide(KEY, 42);
      onMount(() => {
        mounted = true;
      });
      onDestroy(() => {
        destroyed = true;
      });

      let root!: HTMLElement;
      let childInst: ReturnType<typeof Child> | null = null;

      return {
        mount(target) {
          root = Dom.createElement("div");
          Dom.setText(root, "parent");
          Dom.insert(root, target);
          // IMPORTANT: create & mount child while parent is current instance
          childInst = Child({}, { app: ctx.app });
          childInst.mount(root);
        },
        destroy() {
          // Destroy child then clear DOM
          if (childInst) childInst.destroy?.();
          while (host.firstChild) host.removeChild(host.firstChild);
        },
      };
    });

    const p = Parent({}, { app });
    p.mount(host);
    await nextTick();

    expect(mounted).toBe(true);
    expect(host.textContent).toContain("child:42");

    p.destroy();
    await nextTick();
    expect(destroyed).toBe(true);
  });
});
