import { describe, it, expect, vi } from "vitest";
import { createState, nextTick } from "@marwajs/core";
import { effect, stop } from "@marwajs/core";

describe("createState", () => {
  it("get/set/patch work with strong typing", () => {
    const user = createState({ id: 1, name: "A" });

    expect(user.get()).toEqual({ id: 1, name: "A" });

    user.set({ id: 2, name: "B" });
    expect(user.get()).toEqual({ id: 2, name: "B" });

    user.patch({ name: "C" });
    expect(user.get()).toEqual({ id: 2, name: "C" });

    user.set((prev) => ({ ...prev, id: prev.id + 1 }));
    expect(user.get().id).toBe(3);
  });

  it("select returns a computed reader", () => {
    const counter = createState({ count: 1 });
    const double = counter.select((s) => s.count * 2);

    expect(double()).toBe(2);

    counter.patch({ count: 2 });
    expect(double()).toBe(4);
  });

  it("action wraps a mutator and commits a new reference", () => {
    const s = createState({ list: [1, 2] });
    const add = s.action((draft, n: number) => {
      draft.list = [...draft.list, n];
    });

    const prevRef = s.get();
    add(3);
    const nextRef = s.get();

    expect(nextRef.list).toEqual([1, 2, 3]);
    expect(nextRef).not.toBe(prevRef); // new object
  });

  it("subscribe notifies on changes and can be unsubscribed", async () => {
    const s = createState({ n: 0 });
    const spy = vi.fn();

    const off = s.subscribe(spy);
    expect(spy).toHaveBeenCalledTimes(1); // initial sync call from subscribe()

    s.patch({ n: 1 });
    await nextTick();
    expect(spy).toHaveBeenCalledTimes(2); // after patch

    s.set((prev) => ({ ...prev, n: prev.n + 1 }));
    await nextTick();
    expect(spy).toHaveBeenCalledTimes(3); // after set

    off();
    s.patch({ n: 9 });
    await nextTick();
    expect(spy).toHaveBeenCalledTimes(3); // unchanged after unsubscribe
  });

  it("plays nice with effect() reactivity", async () => {
    const s = createState({ n: 1 });
    let seen = 0;
    const runner = effect(() => {
      void s.get().n;
      seen++;
    });
    // first run
    expect(seen).toBe(1);

    s.patch({ n: 2 });
    await nextTick();
    expect(seen).toBe(2);
    stop(runner);
  });
});
