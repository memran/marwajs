import type { ReactiveEffect } from "../reactivity/internals";
import { stop, __setEffectScopeHook } from "../reactivity/effect";

export interface ComponentHooks<TProps = any> {
  mount(target: Node, anchor?: Node | null): void;
  patch?(nextProps?: Partial<TProps>): void;
  destroy?(): void;
}

export interface ComponentContext {
  app: import("./app").App;
}

export type ComponentSetup<TProps = any> = (
  props: TProps,
  ctx: ComponentContext
) => ComponentHooks<TProps>;

interface ComponentInstance {
  parent: ComponentInstance | null;
  app: import("./app").App;
  isMounted: boolean;
  provides: Record<any, any>;
  mountCbs: Array<() => void>;
  destroyCbs: Array<() => void>;
  effects: Set<ReactiveEffect>;
}

let currentInstance: ComponentInstance | null = null;

function getCurrentInstance(): ComponentInstance | null {
  return currentInstance;
}

/** Auto-register effects created while a component is the current instance */
__setEffectScopeHook((runner) => {
  const i = getCurrentInstance();
  if (i) i.effects.add(runner);
});

export function defineComponent<TProps = any>(setup: ComponentSetup<TProps>) {
  return function create(
    props: TProps,
    ctx: ComponentContext
  ): ComponentHooks<TProps> {
    const parent = currentInstance;
    const instance: ComponentInstance = {
      parent,
      app: ctx.app,
      isMounted: false,
      provides: Object.create(parent?.provides || null),
      mountCbs: [],
      destroyCbs: [],
      effects: new Set(),
    };

    // Run setup with this instance as current to capture effects
    currentInstance = instance;
    const hooks = setup(props, ctx);
    currentInstance = parent;

    const wrapped: ComponentHooks<TProps> = {
      mount(target, anchor) {
        currentInstance = instance;
        hooks.mount(target, anchor);
        instance.isMounted = true;
        // run onMount callbacks
        for (const cb of instance.mountCbs) {
          try {
            cb();
          } catch {}
        }
        instance.mountCbs.length = 0;
        currentInstance = parent;
      },
      patch(nextProps) {
        if (hooks.patch) {
          currentInstance = instance;
          hooks.patch(nextProps);
          currentInstance = parent;
        }
      },
      destroy() {
        currentInstance = instance;
        try {
          if (hooks.destroy) hooks.destroy();
        } finally {
          // stop any effects created within this component
          for (const e of instance.effects) stop(e);
          instance.effects.clear();
          // run destroy cbs
          for (const cb of instance.destroyCbs) {
            try {
              cb();
            } catch {}
          }
          instance.destroyCbs.length = 0;
          instance.isMounted = false;
          currentInstance = parent;
        }
      },
    };

    return wrapped;
  };
}

/** Register a function to run right after first mount. */
export function onMount(cb: () => void): void {
  const i = getCurrentInstance();
  if (!i) return;
  i.mountCbs.push(cb);
}

/** Register a function to run on destroy (unmount). */
export function onDestroy(cb: () => void): void {
  const i = getCurrentInstance();
  if (!i) return;
  i.destroyCbs.push(cb);
}

/** Provide a value to descendants by key (prototype-chain lookup). */
export function provide<T>(key: any, value: T): void {
  const i = getCurrentInstance();
  if (!i) return;
  i.provides[key] = value;
}

/** Inject a value from ancestors (or default). */
export function inject<T = any>(key: any, defaultValue?: T): T | undefined {
  const i = getCurrentInstance();
  if (!i) return defaultValue;
  // prototype chain lookup
  if (key in i.provides) return i.provides[key];
  return defaultValue;
}
