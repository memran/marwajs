import { track, trigger } from "./internals";

// Use a *unique symbol* so interfaces/classes can reference it in types.
export const RefFlag: unique symbol = Symbol("isRef");

export interface Ref<T> {
  value: T;
  readonly [RefFlag]: true;
}

class RefImpl<T> implements Ref<T> {
  private _value: T;
  public readonly [RefFlag] = true as const;

  constructor(value: T) {
    this._value = value;
  }

  get value(): T {
    track(this, "value");
    return this._value;
  }

  set value(next: T) {
    if (Object.is(this._value, next)) return;
    this._value = next;
    trigger(this, "value");
  }
}

export function ref<T>(value: T): Ref<T> {
  return new RefImpl<T>(value);
}

export function isRef<T = any>(r: unknown): r is Ref<T> {
  return !!(r as any)?.[RefFlag];
}

export function unref<T>(r: T | Ref<T>): T {
  return isRef(r) ? r.value : r;
}
