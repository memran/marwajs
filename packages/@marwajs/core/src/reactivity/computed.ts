import type { Ref } from "./ref";
import { RefFlag } from "./ref";
import {
  ReactiveEffect,
  createReactiveEffect,
  track,
  trigger,
} from "./internals";

/**
 * Lazy, cached computed ref.
 * - Tracks deps via an internal ReactiveEffect.
 * - On source change: marks dirty and triggers dependents that read .value.
 * - On first/next access after invalidation: recomputes synchronously.
 */
class ComputedRefImpl<T> implements Ref<T> {
  private _value!: T;
  private _dirty = true;
  private _effect: ReactiveEffect;
  public readonly [RefFlag] = true as const;

  constructor(getter: () => T) {
    // DO NOT run immediately; stay lazy.
    this._effect = createReactiveEffect(
      getter,
      // Scheduler runs when any dependency of `getter` changes.
      () => {
        if (!this._dirty) {
          this._dirty = true;
          // Notify dependents that read `c.value`
          trigger(this, "value");
        }
      }
    );
  }

  get value(): T {
    // Reading computed should register dependency on its "value"
    track(this, "value");

    if (this._dirty) {
      // Force a recompute (runner returns getter result)
      this._value = this._effect(true) as T;
      this._dirty = false;
    }
    return this._value;
  }

  // readonly: ignore writes
  set value(_: T) {
    /* no-op */
  }
}

export function computed<T>(getter: () => T): Readonly<Ref<T>> {
  return new ComputedRefImpl(getter) as Readonly<Ref<T>>;
}
