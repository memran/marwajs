import { describe, it, expect } from "vitest";
import {
  ref,
  reactive,
  computed,
  effect,
  stop,
  untrack,
  isRef,
  unref,
  isReactive,
  toRaw,
  nextTick,
} from "../src";

describe("reactivity basics", () => {
  it("ref works", async () => {
    const n = ref(1);
    let hits = 0;
    const r = effect(() => {
      void n.value;
      hits++;
    });
    expect(hits).toBe(1);

    n.value = 2;
    await nextTick();
    expect(hits).toBe(2);

    stop(r);
  });

  it("reactive nested", async () => {
    const s = reactive({ a: 1, nested: { v: 10 } });
    let hits = 0;
    const r = effect(() => {
      void s.nested.v;
      hits++;
    });
    expect(hits).toBe(1);

    s.nested.v = 11;
    await nextTick();
    expect(hits).toBe(2);

    stop(r);
  });

  it("array mutations trigger effects", async () => {
    const a = reactive<number[]>([]);
    let len = 0;
    const r = effect(() => {
      len = a.length;
    });
    expect(len).toBe(0);

    a.push(1);
    await nextTick();
    expect(len).toBe(1);

    a.push(2, 3);
    await nextTick();
    expect(len).toBe(3);

    a.pop();
    await nextTick();
    expect(len).toBe(2);

    stop(r);
  });

  it("deleteProperty triggers effects", async () => {
    const s = reactive<{ a?: number }>({ a: 1 });
    let seen: number | undefined;
    const r = effect(() => {
      seen = s.a;
    });
    expect(seen).toBe(1);

    delete s.a;
    await nextTick();
    expect(seen).toBeUndefined();

    stop(r);
  });

  it("isRef/unref & isReactive/toRaw", () => {
    const n = ref(5);
    expect(isRef(n)).toBe(true);
    expect(unref(n)).toBe(5);
    expect(isRef(10)).toBe(false);
    expect(unref(10)).toBe(10);

    const raw = { a: 1 };
    const s = reactive(raw);
    expect(isReactive(s)).toBe(true);
    expect(toRaw(s)).toBe(raw);
  });
});

describe("effect()", () => {
  it("can be stopped and cleaned up", async () => {
    const n = ref(0);
    let runs = 0;
    const r = effect(() => {
      void n.value;
      runs++;
    });

    expect(runs).toBe(1);
    n.value = 1;
    await nextTick();
    expect(runs).toBe(2);

    stop(r);
    n.value = 2;
    await nextTick();
    expect(runs).toBe(2);
  });

  it("supports dependency switching with cleanup", async () => {
    const toggle = ref(true);
    const a = ref(1);
    const b = ref(1);
    let runs = 0;

    const r = effect(() => {
      runs++;
      if (toggle.value) void a.value;
      else void b.value;
    });

    expect(runs).toBe(1);

    toggle.value = false;
    await nextTick();
    expect(runs).toBe(2);

    a.value = 2; // no longer tracked
    await nextTick();
    expect(runs).toBe(2);

    b.value = 2; // tracked now
    await nextTick();
    expect(runs).toBe(3);

    stop(r);
  });

  it("batches multiple mutations into a single rerun (microtask)", async () => {
    const s = reactive({ a: 1, b: 2 });
    let runs = 0;

    const r = effect(() => {
      void s.a;
      void s.b;
      runs++;
    });

    expect(runs).toBe(1);
    s.a = 10;
    s.b = 20;
    s.a = 11;
    await nextTick();
    expect(runs).toBe(2);

    stop(r);
  });

  it("untrack prevents dependency collection", async () => {
    const a = ref(1);
    let runs = 0;
    const r = effect(() => {
      runs++;
      untrack(() => {
        void a.value;
      });
    });

    expect(runs).toBe(1);
    a.value = 2;
    await nextTick();
    expect(runs).toBe(1);

    stop(r);
  });
});

describe("computed()", () => {
  it("is lazy and caches until dependencies change", () => {
    const a = ref(1);
    const b = ref(2);
    let evals = 0;

    const c = computed(() => {
      evals++;
      return a.value + b.value;
    });

    expect(evals).toBe(0);
    expect(c.value).toBe(3);
    expect(evals).toBe(1);

    // cached
    expect(c.value).toBe(3);
    expect(evals).toBe(1);

    a.value = 5;
    expect(evals).toBe(1); // not recomputed yet
    expect(c.value).toBe(7); // recompute on access
    expect(evals).toBe(2);
  });

  it("notifies dependents when sources change", async () => {
    const a = ref(1);
    const c = computed(() => a.value * 2);
    let runs = 0;
    const r = effect(() => {
      void c.value;
      runs++;
    });

    expect(runs).toBe(1);
    a.value = 2;
    await nextTick();
    expect(runs).toBe(2);

    stop(r);
  });

  it("works with reactive() sources too", () => {
    const s = reactive({ a: 1, b: 2 });
    const c = computed(() => s.a + s.b);
    expect(c.value).toBe(3);
    s.a = 5; // computed is lazy; no need for nextTick since we read synchronously
    expect(c.value).toBe(7);
  });

  it("is readonly (set is a no-op)", () => {
    const a = ref(1);
    const c = computed(() => a.value + 1);
    (c as any).value = 999;
    expect(c.value).toBe(2);
  });
});
