import { track, trigger, pauseTracking, enableTracking } from "./internals";

const ReactiveFlag = Symbol("isReactive");
const rawMap = new WeakMap<object, object>();
const reactiveMap = new WeakMap<object, any>();

export function isObject(val: unknown): val is object {
  return typeof val === "object" && val !== null;
}

export function isReactive<T extends object>(obj: T): boolean {
  return !!(obj as any)?.[ReactiveFlag];
}

export function toRaw<T extends object>(observed: T): T {
  return (rawMap.get(observed as any) as T) ?? observed;
}

// Array method instrumentation: ensure dependents of `length` are triggered
const LENGTH_AFFECTING = new Set(["push", "pop", "shift", "unshift", "splice"]);
const MUTATION_WRAP = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
]);

const baseHandlers: ProxyHandler<any> = {
  get(target, key, receiver) {
    if (key === ReactiveFlag) return true;

    // Instrument array mutation methods to ensure correct triggering
    if (
      Array.isArray(target) &&
      typeof key === "string" &&
      MUTATION_WRAP.has(key)
    ) {
      // Return a wrapped method
      return (...args: any[]) => {
        // Avoid tracking inside method internals (e.g., 'length' reads)
        pauseTracking();
        try {
          const res = (Array.prototype as any)[key].apply(receiver, args);
          // Explicitly notify any effects that read `arr.length`
          if (LENGTH_AFFECTING.has(key)) {
            trigger(target, "length");
          }
          return res;
        } finally {
          enableTracking();
        }
      };
    }

    const res = Reflect.get(target, key, receiver);
    // Track property access (including `length`)
    track(target, key);
    // Deep reactive for nested objects
    return isObject(res) ? reactive(res) : res;
  },

  set(target, key, value, receiver) {
    const old = (target as any)[key];
    const result = Reflect.set(target, key, value, receiver);

    // Only trigger if value actually changed (covers NaN via Object.is)
    if (!Object.is(old, value)) {
      trigger(target, key);
      // When setting array `length` directly, also notify length dependents
      if (Array.isArray(target) && key === "length") {
        trigger(target, "length");
      }
    }
    return result;
  },

  deleteProperty(target, key) {
    const had = Object.prototype.hasOwnProperty.call(target, key);
    const result = Reflect.deleteProperty(target, key);
    if (had && result) trigger(target, key);
    return result;
  },
};

export function reactive<T extends object>(target: T): T {
  if (!isObject(target)) return target;
  if (isReactive(target)) return target;
  const existing = reactiveMap.get(target);
  if (existing) return existing;

  const proxy = new Proxy(target, baseHandlers);
  reactiveMap.set(target, proxy);
  rawMap.set(proxy, target);
  return proxy;
}
