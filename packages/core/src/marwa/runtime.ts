// src/runtime.ts
import { Scope } from './eval';
import { mountTemplate, MountHooks } from './compile';

/* ========================= Types ========================= */

export type SetupContext = {
  emit: (event: string, ...args: any[]) => void;
  provide: (key: any, value: any) => void;
  inject: <T = any>(key: any, fallback?: T) => T | undefined;
  parent: ComponentInstance | null;
  app: AppInstance;
};

export type SetupFn = (props: Record<string, any>, ctx: SetupContext) => Record<string, any>;
export type ComponentOptions = { template: string; setup: SetupFn };
export type Component = ComponentOptions;

export type AppInstance = {
  mount: (el: string | Element, props?: Record<string, any>) => ComponentInstance;
};

export type ComponentInstance = {
  el: Element;
  props: Record<string, any>;
  ctx: SetupContext;
  scope: Scope;
  hooks: MountHooks;
  provides: Record<any, any>;
  parent: ComponentInstance | null;
  app: AppInstance;
  unmount(): void;
};

/* ========================= Public API ========================= */

export function defineComponent(options: ComponentOptions): Component {
  return options;
}

export function createApp(root: Component): AppInstance {
  const app: AppInstance = {
    mount(target: string | Element, props: Record<string, any> = {}) {
      const el = typeof target === 'string' ? document.querySelector(target)! : target;
      if (!el) throw new Error('mount target not found');
      const parent: ComponentInstance | null = null;
      return mountComponent(root, el, props, parent, app);
    }
  };
  return app;
}

/* ========================= Current instance & DI ========================= */

let _currentInstance: ComponentInstance | null = null;
const setCurrentInstance = (i: ComponentInstance | null) => (_currentInstance = i);

/** For advanced use/debugging */
export function getCurrentInstance(): ComponentInstance | null {
  return _currentInstance;
}

/** Composition-API style provide: instance-aware */
export function provide(key: any, value: any): void {
  const i = getCurrentInstance();
  if (!i) throw new Error('provide() called outside of setup()');
  i.provides[key] = value;
}

/** Composition-API style inject: instance-aware */
export function inject<T = any>(key: any, fallback?: T): T | undefined {
  const i = getCurrentInstance();
  if (!i) throw new Error('inject() called outside of setup()');
  return (key in i.provides) ? i.provides[key] : fallback;
}

/* ========================= Internal mount helpers ========================= */

function mountComponent(
  comp: Component,
  el: Element,
  props: Record<string, any>,
  parent: ComponentInstance | null,
  app: AppInstance
): ComponentInstance {
  const provides = Object.create(parent?.provides ?? null);
  let scope: Scope = {};
  let hooks: MountHooks;

  const instance: ComponentInstance = {
    el,
    props,
    ctx: {} as any,
    scope: {} as any,
    hooks: {} as any,
    provides,
    parent,
    app,
    unmount() { hooks.unmount(); }
  };

  const ctx: SetupContext = {
    emit: (event, ...args) => {
      const handlerName = event ? event[0].toUpperCase() + event.slice(1) : '';
      const handler = (instance.scope as any)['on' + handlerName];
      if (typeof handler === 'function') handler(...args);
    },
    provide: (key, value) => { provides[key] = value; },
    inject: (key, fallback) => (key in provides ? provides[key] : fallback),
    parent,
    app
  };

  setCurrentInstance(instance);
  try {
    scope = comp.setup(props, ctx) || {};
    // expose props first so {{ prop }} works even if user doesn't return it,
    // also expose app and the parent instance for lazy child mounting & DI
    hooks = mountTemplate(el, comp.template, { ...props, ...scope, app, __mwParent: instance });
  } finally {
    setCurrentInstance(null);
  }

  instance.ctx = ctx;
  instance.scope = scope;
  instance.hooks = hooks;
  return instance;
}

/**
 * Public helper to mount a component **as a child** of an existing instance.
 * Use this when you need DI (provide/inject) across boundaries (e.g., lazy components).
 */
export function mountComponentAsChild(
  comp: Component,
  el: Element,
  props: Record<string, any>,
  parent: ComponentInstance,
  app: AppInstance
): ComponentInstance {
  // Internally just uses the same logic as mountComponent with a non-null parent
  return mountComponent(comp, el, props, parent, app);
}

/* ========================= Lazy component loader ========================= */

type ComponentModule = { default?: any };
type ComponentLoader = (name: string) => Promise<ComponentModule | undefined>;

let __componentLoader: ComponentLoader | null = null;


export function setComponentLoader(fn: ComponentLoader) {
  __componentLoader = fn;
}

/**
 * Mount a lazily-resolved component into `el`.
 * If `parent` is provided, mount as child so DI/provides chain is preserved.
 */
export async function mountLazyComponent(
  name: string,
  el: HTMLElement,
  app: AppInstance,
  props: Record<string, any> = {},
  parent?: ComponentInstance
) {
  if (!__componentLoader) return false;
  if ((el as any).__mwMounted) return true;

  const mod = await __componentLoader(name);
  if (!mod) return false;

  const Comp = (mod as any).default || mod;

  let inst: ComponentInstance;
  if (parent) {
    inst = mountComponentAsChild(Comp, el, props, parent, app);
  } else {
    // Fallback: separate root (no DI inheritance)
    inst = createApp(Comp).mount(el, props);
  }

  (el as any).__mwMounted = inst;
  return true;
}

/* ========================= Utils ========================= */

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
