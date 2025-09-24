import { signal } from "../reactivity/signal";
import { computed } from "../reactivity/computed";
import { effect, stop } from "../reactivity/effect";

export type Updater<T> = (prev: T) => T;

export interface State<T> {
  /** Read current state (reactive if used inside computed/effect via underlying signal) */
  get: () => T;
  /** Replace state; accepts value or updater */
  set: (next: T | Updater<T>) => void;
  /** Shallow patch convenience */
  patch: (partial: Partial<T>) => void;
  /** Create a derived computed selector */
  select: <U>(mapper: (s: T) => U) => () => U;
  /** Wrap a mutator into a typed action */
  action: <A extends any[]>(
    fn: (draft: T, ...args: A) => void
  ) => (...args: A) => void;
  /** Subscribe to changes (fires on every commit) */
  subscribe: (cb: (s: T) => void) => () => void;
}
export function createState<T>(initial: T): State<T> {
  const s = signal<T>(initial);

  const get = () => s();

  //   const set = (next: T | Updater<T>) => {
  //     if (typeof next === "function") {
  //       s.set((next as Updater<T>)(s()));
  //     } else {
  //       s.set(next);
  //     }
  //   };
  const set = (next: T | Updater<T>) => {
    const prev = s();
    const nextVal =
      typeof next === "function" ? (next as Updater<T>)(prev) : next;
    if (Object.is(prev, nextVal)) return; // no-op
    s.set(nextVal);
  };

  const patch = (partial: Partial<T>) => {
    const prev = s();
    //console.log("PATCH - prev:", prev, "partial:", partial);

    if (typeof prev === "object" && prev !== null) {
      if (Array.isArray(prev)) {
        s.set(partial as T);
      } else {
        const next = { ...prev, ...partial };
        // console.log("PATCH - next:", next, "changed?", !Object.is(prev, next));
        s.set(next);
      }
    } else {
      s.set(partial as T);
    }
  };

  const select = <U>(mapper: (s: T) => U) => {
    const c = computed(() => mapper(s()));
    return () => c.value;
  };

  const action = <A extends any[]>(fn: (draft: T, ...args: A) => void) => {
    return (...args: A) => {
      const draft = cloneShallow(s());
      fn(draft, ...args);
      s.set(draft);
    };
  };

  const subscribe = (cb: (s: T) => void) => {
    const runner = effect(() => cb(s()));
    return () => stop(runner);
  };
  return { get, set, patch, select, action, subscribe };
}

function cloneShallow<T>(v: T): T {
  if (Array.isArray(v)) return [...(v as any)] as T;
  if (v && typeof v === "object") return { ...(v as any) };
  // primitives: just return; action mutator can replace via return pathways too
  return v;
}
