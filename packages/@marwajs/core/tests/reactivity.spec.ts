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

describe("ref()", () => {
  it("tracks get/set and triggers effects", async () => {
    const n = ref(1);
    let runs = 0;

    const r = effect(() => {
      // read
      void n.value;
      runs++;
    });

    expect(runs).toBe(1);

    n.value = 2;
    await nextTick();
    expect(runs).toBe(2);

    // same value should not trigger
    n.value = 2;
    await nextTick();
    expect(runs).toBe(2);

    stop(r);
  });

  it("isRef/unref behave correctly", () => {
    const n = ref(5);
    expect(isRef(n)).toBe(true);
    expect(unref(n)).toBe(5);
    expect(isRef(10)).toBe(false);
    expect(unref(10)).toBe(10);
  });
});

describe("reactive()", () => {
  it("proxies nested objects and triggers on mutation", async () => {
    const s = reactive({ a: 1, nested: { v: 10 } });
    let runs = 0;
    const r = effect(() => {
      void s.nested.v;
      runs++;
    });

    expect(runs).toBe(1);
    s.nested.v = 11;
    await nextTick();
    expect(runs).toBe(2);

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

  it("isReactive/toRaw round-trip", () => {
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
    expect(runs).toBe(2); // no more runs
  });

  it("supports dependency switching with cleanup", async () => {
    const toggle = ref(true);
    const a = ref(1);
    const b = ref(1);
    let runs = 0;

    const r = effect(() => {
      runs++;
      if (toggle.value) {
        void a.value;
      } else {
        void b.value;
      }
    });

    expect(runs).toBe(1);

    // Switch to b
    toggle.value = false;
    await nextTick();
    expect(runs).toBe(2);

    // Changing a should NOT trigger now
    a.value = 2;
    await nextTick();
    expect(runs).toBe(2);

    // Changing b SHOULD trigger
    b.value = 2;
    await nextTick();
    expect(runs).toBe(3);

    stop(r);
  });

  it("batches multiple mutations into a single rerun (microtask)", async () => {
    const s = reactive({ a: 1, b: 2 });
    let runs = 0;

    const r = effect(() => {
      // read both so both are deps
      void s.a;
      void s.b;
      runs++;
    });

    expect(runs).toBe(1);

    // multiple sync mutations → one scheduled rerun
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
        // This read should not register as a dependency
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

    // lazy: no eval until first access
    expect(evals).toBe(0);
    expect(c.value).toBe(3);
    expect(evals).toBe(1);

    // cached
    expect(c.value).toBe(3);
    expect(evals).toBe(1);

    // invalidate
    a.value = 5;
    // still not re-evaluated until next access
    expect(evals).toBe(1);
    expect(c.value).toBe(7);
    expect(evals).toBe(2);
  });

  it("notifies dependents when sources change", async () => {
    const a = ref(1);
    const c = computed(() => a.value * 2);
    let runs = 0;

    const r = effect(() => {
      // reading c should register dependency on c
      void c.value;
      runs++;
    });

    expect(runs).toBe(1);
    a.value = 2;
    await nextTick();
    expect(runs).toBe(2);

    stop(r);
  });

  it("is readonly (set is a no-op)", () => {
    const a = ref(1);
    const c = computed(() => a.value + 1);
    (c as any).value = 999;
    expect(c.value).toBe(2);
  });

  it("works with reactive() sources too", () => {
    const s = reactive({ a: 1, b: 2 });
    const c = computed(() => s.a + s.b);
    expect(c.value).toBe(3);
    s.a = 5;
    expect(c.value).toBe(7);
  });
});
