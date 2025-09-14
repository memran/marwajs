import { signal, type Signal } from "./signal";
import { pauseTracking, enableTracking } from "./internals";

const ReactiveFlag = Symbol("isReactive");

const reactiveMap = new WeakMap<object, any>();
const rawMap = new WeakMap<object, object>();
const cells = new WeakMap<object, Map<PropertyKey, Signal<any>>>();

function isObject(v: unknown): v is object {
  return typeof v === "object" && v !== null;
}

export function isReactive<T extends object>(obj: T): boolean {
  return !!(obj as any)?.[ReactiveFlag];
}
export function toRaw<T extends object>(observed: T): T {
  return (rawMap.get(observed as any) as T) ?? observed;
}

function getCell(target: object, key: PropertyKey, init: any): Signal<any> {
  let map = cells.get(target);
  if (!map) {
    map = new Map();
    cells.set(target, map);
  }
  let cell = map.get(key);
  if (!cell) {
    cell = signal(init);
    map.set(key, cell);
  }
  return cell;
}

// array instrumentation
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

    if (
      Array.isArray(target) &&
      typeof key === "string" &&
      MUTATION_WRAP.has(key)
    ) {
      return (...args: any[]) => {
        pauseTracking();
        try {
          const res = (Array.prototype as any)[key].apply(receiver, args);
          if (LENGTH_AFFECTING.has(key)) {
            const len = (target as any).length;
            getCell(target, "length", len).set(len);
          }
          return res;
        } finally {
          enableTracking();
        }
      };
    }

    const value = Reflect.get(target, key, receiver);
    const cell = getCell(target, key, value);
    // track via signal read
    cell();
    return isObject(value) ? reactive(value) : value;
  },

  set(target, key, value, receiver) {
    const old = (target as any)[key];
    const ok = Reflect.set(target, key, value, receiver);
    if (!Object.is(old, value)) {
      getCell(target, key, old).set(value);
      if (Array.isArray(target) && key === "length") {
        getCell(target, "length", value).set(value);
      }
    }
    return ok;
  },

  deleteProperty(target, key) {
    const had = Object.prototype.hasOwnProperty.call(target, key);
    const ok = Reflect.deleteProperty(target, key);
    if (had && ok) {
      getCell(target, key, undefined).set(undefined);
    }
    return ok;
  },
};

export function reactive<T extends object>(target: T): T {
  if (!isObject(target)) return target;
  if (isReactive(target)) return target;
  const cached = reactiveMap.get(target);
  if (cached) return cached;

  const proxy = new Proxy(target, baseHandlers);
  reactiveMap.set(target, proxy);
  rawMap.set(proxy, target);
  return proxy;
}
