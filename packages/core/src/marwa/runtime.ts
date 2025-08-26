import { Scope } from './eval';
import { mountTemplate, MountHooks } from './compile';

// ---------- types ----------
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

export function defineComponent(options: ComponentOptions): Component {
  return options;
}

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

// ---------- current instance + DI composables ----------
let _currentInstance: ComponentInstance | null = null;
const setCurrentInstance = (i: ComponentInstance | null) => (_currentInstance = i);
export function getCurrentInstance(): ComponentInstance | null { return _currentInstance; }

export function provide(key: any, value: any): void {
  const i = getCurrentInstance();
  if (!i) throw new Error('provide() called outside of setup()');
  i.provides[key] = value;
}
export function inject<T = any>(key: any, fallback?: T): T | undefined {
  const i = getCurrentInstance();
  if (!i) throw new Error('inject() called outside of setup()');
  return (key in i.provides) ? i.provides[key] : fallback;
}

// ---------- component loader for lazy SFCs ----------
type ComponentModule = { default?: any };
type ComponentLoader = (name: string) => Promise<ComponentModule | undefined>;
let __componentLoader: ComponentLoader | null = null;

export function setComponentLoader(fn: ComponentLoader) {
  __componentLoader = fn;
}

export async function mountLazyComponent(
  name: string,
  el: HTMLElement,
  app: AppInstance,
  props: Record<string, any> = {}
) {
  if (!__componentLoader) return false;
  if ((el as any).__mwMounted) return true;

  const mod = await __componentLoader(name);
  if (!mod) return false;

  const Comp = (mod as any).default || mod;
  const inst = createApp(Comp).mount(el, props);
  (el as any).__mwMounted = inst;
  return true;
}

// ---------- app & mount ----------
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
      const handler = (instance.scope as any)['on' + capitalize(event)];
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
    // expose props to template scope first so {{ prop }} works without explicit return
    hooks = mountTemplate(el, comp.template, { ...props, ...scope, app });
  } finally {
    setCurrentInstance(null);
  }

  instance.ctx = ctx;
  instance.scope = scope;
  instance.hooks = hooks;
  return instance;
}

const capitalize = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
