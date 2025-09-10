import {
  createReactiveEffect,
  withUntracked,
  cleanup,
  ReactiveEffect,
  scheduleDefault,
} from "./internals";

export interface EffectOptions {
  scheduler?: (runner: () => void) => void;
  onStop?: () => void;
}

// Optional hook so the component runtime can auto-scope effects to an instance.
let __effectScopeHook: ((runner: ReactiveEffect) => void) | null = null;
export function __setEffectScopeHook(
  h: ((runner: ReactiveEffect) => void) | null
) {
  __effectScopeHook = h;
}

/**
 * Create a reactive effect. Returns a runner function you can call manually.
 * Use `stop(runner)` to dispose it.
 */
export function effect(
  fn: () => any,
  options: EffectOptions = {}
): ReactiveEffect {
  const runner = createReactiveEffect(fn, options.scheduler ?? scheduleDefault);
  runner.onStop = options.onStop;
  // Allow runtime to register this effect in a component scope if any
  __effectScopeHook && __effectScopeHook(runner);
  // Run once initially
  runner();
  return runner;
}

/** Stop a previously created effect and cleanup all subscriptions. */
export function stop(runner: ReactiveEffect): void {
  if (runner.active) {
    runner.active = false;
    cleanup(runner);
    runner.onStop && runner.onStop();
  }
}

/** Execute a function without collecting reactive dependencies. */
export function untrack<T>(fn: () => T): T {
  return withUntracked(fn);
}
