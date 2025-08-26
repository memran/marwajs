export type Signal<T> = { get value(): T; set value(v: T); };
export function signal<T>(initial: T): Signal<T> {
  let _v = initial;
  const subs = new Set<() => void>();
  const s: Signal<T> = {
    get value() { return _v; },
    set value(v: T) { _v = v; subs.forEach(f => f()); }
  };
  (s as any).__subs = subs;
  return s;
}
export function effect(fn: () => void) { fn(); } // ultra-tiny; your directives wire updates
export function isSignal(x: any): x is Signal<any> { return x && typeof x === 'object' && 'value' in x; }
