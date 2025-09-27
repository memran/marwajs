import type { ReactiveEffect } from "../reactivity/internals";
import { stop, __setEffectScopeHook } from "../reactivity/effect";

export interface ComponentHooks<TProps = any> {
  mount(target: Node, anchor?: Node | null): void;
  patch?(nextProps?: Partial<TProps>): void;
  destroy?(): void;
}

export interface ComponentContext {
  app: import("./app").App;
  /** Child → Parent custom events */
  emit: (event: string, ...args: any[]) => void;
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
    // 🔧 make ctx optional to avoid crashes in tests or direct usage
    ctxArg?: Omit<ComponentContext, "emit"> & { app: import("./app").App }
  ): ComponentHooks<TProps> {
    // 🔧 normalize ctx; provide minimal shape when omitted
    const baseCtx = ctxArg ?? ({ app: undefined as any } as const);

    const parent = currentInstance;
    const instance: ComponentInstance = {
      parent,
      app: baseCtx.app, // safe now
      isMounted: false,
      provides: Object.create(parent?.provides || null),
      mountCbs: [],
      destroyCbs: [],
      effects: new Set(),
    };

    // Extract component listeners from props (compiler will inject __listeners)
    const raw: any = props as any;
    const listeners: Record<string, Function> =
      (raw && raw.__listeners) || Object.create(null);

    // Do not expose __listeners to user setup() props
    let cleanProps = props;
    if (raw && raw.__listeners) {
      cleanProps = { ...raw };
      delete (cleanProps as any).__listeners;
    }

    // Compose ctx with emit
    const emit = (event: string, ...args: any[]) => {
      const h = listeners[event];
      if (typeof h === "function") {
        h(...args);
      }
    };
    // 🔧 build child ctx from normalized baseCtx
    const childCtx: ComponentContext = { ...(baseCtx as any), emit };

    // Run setup with this instance as current to capture effects
    currentInstance = instance;
    const hooks = setup(cleanProps as TProps, childCtx);
    currentInstance = parent;

    const wrapped: ComponentHooks<TProps> = {
      mount(target, anchor) {
        currentInstance = instance;
        hooks.mount(target, anchor ?? null);
        instance.isMounted = true;
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
  if (key in i.provides) return i.provides[key];
  return defaultValue;
}
