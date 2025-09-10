import { queueJob } from "../scheduler";

export type Key = PropertyKey;
export type Dep = Set<ReactiveEffect>;

export interface ReactiveEffect {
  (force?: boolean): any;
  _id: number;
  active: boolean;
  deps: Dep[]; // <-- FIX: was Set<Dep>[]
  scheduler?: (runner: () => void) => void;
  onStop?: () => void;
}

let _effectId = 0;

export const targetMap: WeakMap<object, Map<Key, Dep>> = new WeakMap();

export let activeEffect: ReactiveEffect | undefined;
const effectStack: ReactiveEffect[] = [];
let shouldTrack = true;

export function pauseTracking() {
  shouldTrack = false;
}
export function enableTracking() {
  shouldTrack = true;
}

export function withUntracked<T>(fn: () => T): T {
  if (!shouldTrack) return fn();
  pauseTracking();
  try {
    return fn();
  } finally {
    enableTracking();
  }
}

export function track(target: object, key: Key): void {
  if (!activeEffect || !activeEffect.active || !shouldTrack) return;
  let depsMap = targetMap.get(target);
  if (!depsMap) targetMap.set(target, (depsMap = new Map()));
  let dep = depsMap.get(key);
  if (!dep) depsMap.set(key, (dep = new Set()));
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect);
    activeEffect.deps.push(dep); // <-- OK now: dep is Dep
  }
}

export function trigger(target: object, key: Key): void {
  const depsMap = targetMap.get(target);
  if (!depsMap) return;
  const dep = depsMap.get(key);
  if (!dep || dep.size === 0) return;

  const effects = new Set<ReactiveEffect>(dep);
  for (const e of effects) {
    if (!e.active) continue;
    if (e.scheduler) {
      e.scheduler(e as any);
    } else {
      queueJob(e as any);
    }
  }
}

export function createReactiveEffect(
  fn: () => any,
  scheduler?: (runner: () => void) => void
): ReactiveEffect {
  const effect: ReactiveEffect = function runner(force?: boolean) {
    if (!effect.active && !force) return;
    cleanup(effect);
    try {
      effectStack.push(effect);
      activeEffect = effect;
      return fn();
    } finally {
      effectStack.pop();
      activeEffect = effectStack[effectStack.length - 1];
    }
  } as ReactiveEffect;

  effect._id = ++_effectId;
  effect.active = true;
  effect.deps = [];
  effect.scheduler = scheduler;
  return effect;
}

export function cleanup(effect: ReactiveEffect): void {
  const { deps } = effect;
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect);
    }
    deps.length = 0;
  }
}

export function scheduleDefault(runner: () => void) {
  queueJob(runner);
}
