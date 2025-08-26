import { signal, type Signal } from './reactivity';
import { devEmit } from './devtools';

type StoreOptions = { immutable?: boolean };

export function createStore<T extends object>(initial: T, opts?: StoreOptions) {
  if (opts?.immutable) {
    const state = signal<T>(Object.freeze({ ...initial }));
    return {
      state,
      update(fn: (s: T) => T) {
        const prev = state.value;
        const next = Object.freeze(fn(prev));
        state.value = next;
        devEmit({ type: 'store:update', token: 'anonymous', prev, next });
      }
    };
  }
  const store: any = {};
  for (const k in initial) {
    const s = signal((initial as any)[k]);
    store[k] = s;
    Object.defineProperty(store, k, {
      get: () => s,
      set: (val) => {
        const prev = s.value; s.value = val;
        devEmit({ type: 'signal:set', key: k, prev, next: val });
      }
    });
  }
  return store as { [K in keyof T]: Signal<T[K]> };
}
