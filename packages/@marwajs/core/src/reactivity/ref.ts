import { signal } from "./signal";

export const RefFlag: unique symbol = Symbol("isRef");

export interface Ref<T> {
  value: T;
  readonly [RefFlag]: true;
}

export function ref<T>(value: T): Ref<T> {
  const s = signal<T>(value);
  return {
    get value() {
      return s();
    },
    set value(v: T) {
      s.set(v);
    },
    [RefFlag]: true as const,
  };
}

export function isRef<T = any>(r: unknown): r is Ref<T> {
  return !!(r as any)?.[RefFlag];
}

export function unref<T>(r: T | Ref<T>): T {
  return isRef(r) ? r.value : r;
}
