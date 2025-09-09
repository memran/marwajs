/* Tiny reactive core: ref, computed, effect */

export type Cleanup = () => void;
type Subscriber = () => void;

export class Ref<T> {
  private _v: T;
  private subs = new Set<Subscriber>();
  constructor(v: T) { this._v = v; }
  get value() { track(this); return this._v; }
  set value(v: T) { if (v !== this._v) { this._v = v; trigger(this); } }
  _subscribe(s: Subscriber) { this.subs.add(s); }
  _unsubscribe(s: Subscriber) { this.subs.delete(s); }
  _notify() { for (const s of Array.from(this.subs)) s(); }
}
export function ref<T>(v: T) { return new Ref<T>(v); }

const stack: Subscriber[] = [];
function track(r: Ref<any>) {
  const eff = stack.length ? stack[stack.length - 1] : undefined;
  if (eff) r._subscribe(eff);
}
function trigger(r: Ref<any>) { r._notify(); }

export function effect(fn: () => void): Cleanup {
  const runner = () => { cleanup(); stack.push(runner); try { fn(); } finally { stack.pop(); } };
  const deps: Set<Ref<any>> = new Set();
  const cleanup = () => deps.forEach(d => d._unsubscribe(runner));
  // patch subscribe to capture deps during this effect run
  const orig = (Ref.prototype as any)._subscribe;
  (Ref.prototype as any)._subscribe = function (s: Subscriber) {
    deps.add(this as any);
    return orig.call(this, s);
  };
  runner();
  (Ref.prototype as any)._subscribe = orig;
  return cleanup;
}

export function computed<T>(getter: () => T) {
  const r = ref<T>(undefined as any);
  effect(() => r.value = getter());
  return r;
}
