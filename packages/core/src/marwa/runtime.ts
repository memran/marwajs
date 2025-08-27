// src/runtime.ts
import { Scope } from './eval';
import { mountTemplate, MountHooks } from './compile';

/* ===========================================================
 * Types (existing + plugin ecosystem)
 * =========================================================== */

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

/** Plugin system types */
export type EvaluateFn = (code: string, scope: any) => any;
export type EffectFn = (runner: () => void) => void;

export type DirectiveMount = (args: {
  el: HTMLElement;
  expr: string;
  evaluate: EvaluateFn;
  effect: EffectFn;
  scope: any;
  app: AppInstance;
}) => void | (() => void);

export type DirectiveMap = Record<string, DirectiveMount>;
export type ServiceMap = Record<string | symbol, any>;

export type MarwaPlugin = {
  /** Unique plugin name (used for dedupe & deps). */
  name: string;
  /** Optional dependencies by name. */
  deps?: string[];
  /** Directives contributed by this plugin. */
  directives?: DirectiveMap;
  /** Global services provided by this plugin. */
  provides?: ServiceMap;
  /** Called once on install. */
  setup?: (app: AppInstance) => void | Promise<void>;
};

export type MarwaPluginFactory = () => Promise<MarwaPlugin> | MarwaPlugin;

/** Authoring helper (zero runtime cost) */
export function definePlugin<P extends MarwaPlugin>(p: P): P { return p; }

/** Hooks hub */
type Hook<T> = Set<(p: T) => void>;
function createHook<T>() {
  const s: Hook<T> = new Set();
  return {
    on(cb: (p: T) => void) { s.add(cb); return () => s.delete(cb); },
    emit(p: T) { for (const fn of s) { try { fn(p); } catch (e) { console.error('[marwa:hook]', e); } } }
  };
}

export type ComponentCtxHook = {
  app: AppInstance;
  el: HTMLElement | DocumentFragment;
  scope: any;
  name?: string;
};

export type MarwaHooks = {
  onInit: ReturnType<typeof createHook<AppInstance>>;
  onComponentMount: ReturnType<typeof createHook<ComponentCtxHook>>;
  onComponentUnmount: ReturnType<typeof createHook<ComponentCtxHook>>;
};

/** AppInstance – extended with plugin/DI/directives/hooks */
export type AppInstance = {
  // existing public API
  mount: (el: string | Element, props?: Record<string, any>) => ComponentInstance;

  // plugin API
  use: (pluginOrFactory: MarwaPlugin | MarwaPluginFactory) => Promise<AppInstance>;
  register: (name: string, factory: MarwaPluginFactory) => void;
  hasPlugin: (name: string) => boolean;

  // app-level DI (for plugins/services). Note: you still have instance provide/inject too.
  provide: (key: any, value: any) => void;
  inject: <T = any>(key: any, fallback?: T) => T | undefined;

  // directives registry
  directive: (name: string, mount: DirectiveMount) => void;
  _resolveDirective: (name: string) => DirectiveMount | undefined;

  // hooks
  hooks: MarwaHooks;

  // bridges (wired by compiler at boot; used by directives)
  _evaluate: EvaluateFn;
  _effect: EffectFn;

  // internals (useful for advanced plugins)
  _directives: Map<string, DirectiveMount>;
  _services: Map<any, any>;
  _installed: Set<string>;
  _pending: Map<string, Promise<void>>;
  _registry: Map<string, MarwaPluginFactory>;
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

/* ===========================================================
 * Public API (existing)
 * =========================================================== */

export function defineComponent(options: ComponentOptions): Component {
  return options;
}

/* ===========================================================
 * Plugin system internals
 * =========================================================== */

function createHooks(): MarwaHooks {
  return {
    onInit: createHook<AppInstance>(),
    onComponentMount: createHook<ComponentCtxHook>(),
    onComponentUnmount: createHook<ComponentCtxHook>(),
  };
}

async function resolveDeps(app: AppInstance, plugin: MarwaPlugin, stack: string[] = []) {
  if (!plugin.deps || plugin.deps.length === 0) return;
  for (const dep of plugin.deps) {
    if (app._installed.has(dep)) continue;
    if (stack.includes(dep)) {
      throw new Error(`[marwa:plugin] Circular dependency: ${[...stack, dep].join(' -> ')}`);
    }
    const pending = app._pending.get(dep);
    if (pending) { await pending; continue; }
    const factory = app._registry.get(dep);
    if (!factory) throw new Error(`[marwa:plugin] "${plugin.name}" requires "${dep}" — register a factory for it first.`);
    const task = (async () => {
      const got = await factory();
      if (!got || got.name !== dep) throw new Error(`[marwa:plugin] Factory for "${dep}" did not return a matching plugin.`);
      await installPlugin(app, got, [...stack, plugin.name]);
    })();
    app._pending.set(dep, task);
    await task;
    app._pending.delete(dep);
  }
}

async function installPlugin(app: AppInstance, plugin: MarwaPlugin, stack: string[] = []) {
  const name = plugin.name || '(anonymous)';
  if (app._installed.has(name)) return;

  await resolveDeps(app, plugin, stack);

  // services
  if (plugin.provides) {
    for (const [k, v] of Object.entries(plugin.provides)) {
      app._services.set(k, v);
    }
  }
  // directives
  if (plugin.directives) {
    for (const [n, d] of Object.entries(plugin.directives)) {
      app._directives.set(n, d);
    }
  }
  // setup
  if (plugin.setup) await plugin.setup(app);

  app._installed.add(name);
}

function isFactory(x: any): x is MarwaPluginFactory {
  return typeof x === 'function' && !('name' in x) && !('setup' in x) && !('directives' in x);
}

async function usePlugin(app: AppInstance, p: MarwaPlugin | MarwaPluginFactory): Promise<void> {
  if (isFactory(p)) {
    const key = '__lazy_' + Math.random().toString(36).slice(2);
    const task = (async () => {
      const plug = await (p as MarwaPluginFactory)();
      if (!plug || typeof plug.name !== 'string') throw new Error('[marwa:plugin] lazy factory did not return a valid plugin');
      await installPlugin(app, plug);
    })();
    app._pending.set(key, task);
    await task;
    app._pending.delete(key);
    return;
  }
  const plug = p as MarwaPlugin;
  if (!plug.name) throw new Error('[marwa:plugin] invalid plugin — missing "name"');
  const pending = app._pending.get(plug.name);
  if (pending) { await pending; return; }
  const task = installPlugin(app, plug);
  app._pending.set(plug.name, task);
  await task;
  app._pending.delete(plug.name);
}

/* ===========================================================
 * App factory (enhanced)
 * =========================================================== */

export function createApp(root: Component): AppInstance {
  const directives = new Map<string, DirectiveMount>();
  const services = new Map<any, any>();
  const hooks = createHooks();

  const app: AppInstance = {
    /* ---------------- mount (existing behavior) ---------------- */
    mount(target: string | Element, props: Record<string, any> = {}) {
      const el = typeof target === 'string' ? document.querySelector(target)! : target;
      if (!el) throw new Error('mount target not found');
      const parent: ComponentInstance | null = null;
      const inst = mountComponent(root, el, props, parent, app);
      hooks.onInit.emit(app);
      hooks.onComponentMount.emit({ app, el, scope: inst.scope, name: 'Root' });
      return inst;
    },

    /* ---------------- plugins ---------------- */
    async use(pluginOrFactory: MarwaPlugin | MarwaPluginFactory) {
      await usePlugin(app, pluginOrFactory);
      return app;
    },
    register(name: string, factory: MarwaPluginFactory) {
      app._registry.set(name, factory);
    },
    hasPlugin(name: string) {
      return app._installed.has(name);
    },

    /* ---------------- app-level DI for plugins ---------------- */
    provide(key: any, value: any) { services.set(key, value); },
    inject<T = any>(key: any, fallback?: T): T | undefined {
      return (services.has(key) ? services.get(key) : fallback) as T | undefined;
    },

    /* ---------------- directives registry ---------------- */
    directive(name: string, mount: DirectiveMount) { directives.set(name, mount); },
    _resolveDirective(name: string) { return directives.get(name); },

    /* ---------------- hooks + bridges ---------------- */
    hooks,
    _evaluate: (_code: string, _scope: any) => { throw new Error('[marwa] evaluate bridge not set'); },
    _effect: (_runner: () => void) => { throw new Error('[marwa] effect bridge not set'); },

    /* ---------------- internals ---------------- */
    _directives: directives,
    _services: services,
    _installed: new Set<string>(),
    _pending: new Map<string, Promise<void>>(),
    _registry: new Map<string, MarwaPluginFactory>(),
  };

  return app;
}

/* ===========================================================
 * Current instance & instance-level DI (existing)
 * =========================================================== */

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
  return (key in i.provides) ? (i.provides[key] as T) : i.app.inject<T>(key, fallback);
}

/* ===========================================================
 * Internal mount helpers (existing)
 * =========================================================== */

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
      const handlerName = event ? capitalize(event) : '';
      const handler = (instance.scope as any)['on' + handlerName];
      if (typeof handler === 'function') handler(...args);
    },
    provide: (key, value) => { provides[key] = value; },
    inject: (key, fallback) => (key in provides ? provides[key] : app.inject(key, fallback)),
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
  return mountComponent(comp, el, props, parent, app);
}

/* ===========================================================
 * Lazy component loader (existing)
 * =========================================================== */

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

/* ===========================================================
 * Utilities
 * =========================================================== */

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Resolver export for compiler/binder to get plugin directives */
export function resolveDirective(app: AppInstance, name: string): DirectiveMount | undefined {
  return app._resolveDirective(name);
}
