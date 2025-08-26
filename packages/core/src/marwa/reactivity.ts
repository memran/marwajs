// Tiny signal/reactivity system (Vue-like feel, no deps)
type Dep = Set<ReactiveEffect>;
type KeyToDep = Map<PropertyKey, Dep>;
const targetMap = new WeakMap<object, KeyToDep>();

let activeEffect: ReactiveEffect | null = null;

class ReactiveEffect {
  constructor(public fn: () => any) {}
  run() {
    try {
      activeEffect = this;
      return this.fn();
    } finally {
      activeEffect = null;
    }
  }
}

function track(target: object, key: PropertyKey) {
  if (!activeEffect) return;
  let depsMap = targetMap.get(target);
  if (!depsMap) targetMap.set(target, (depsMap = new Map()));
  let dep = depsMap.get(key);
  if (!dep) depsMap.set(key, (dep = new Set()));
  dep.add(activeEffect);
}

function trigger(target: object, key: PropertyKey) {
  const depsMap = targetMap.get(target);
  if (!depsMap) return;
  const dep = depsMap.get(key);
  if (!dep) return;
  for (const eff of dep) eff.run();
}

export interface Ref<T> { value: T }
const RefFlag = Symbol('isRef');

export function ref<T>(value: T): Ref<T> {
  const box = {
    [RefFlag]: true,
    get value() { track(box, 'value'); return value; },
    set value(v: T) { value = v; trigger(box, 'value'); }
  } as Ref<T> & { [RefFlag]: true };
  return box;
}

export function isRef(r: any): r is Ref<any> {
  return !!(r && r[RefFlag]);
}
export function unref<T>(r: T | Ref<T>): T {
  return isRef(r) ? r.value : r;
}

export function reactive<T extends object>(obj: T): T {
  return new Proxy(obj, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      track(t, k);
      return v;
    },
    set(t, k, v, r) {
      const old = (t as any)[k];
      const ok = Reflect.set(t, k, v, r);
      if (ok && old !== v) trigger(t, k);
      return ok;
    }
  });
}

export function effect(fn: () => any): () => void {
  const e = new ReactiveEffect(fn);
  e.run();
  return () => { /* tiny; effects auto re-run, no stop registry in this minimal core */ };
}

export function computed<T>(getter: () => T): Ref<T> {
  const r = ref<T>(undefined as any);
  effect(() => { r.value = getter(); });
  return r;
}

export const watchEffect = effect;
