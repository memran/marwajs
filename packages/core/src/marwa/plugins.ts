// Tiny, structured plugin system for MarwaJS with lazy loading & dependency resolver.

export type Unsubscribe = () => void;

/* ---------------- Hooks ---------------- */

type Hook<T> = Set<(p: T) => void>;
function createHook<T = any>() {
  const s: Hook<T> = new Set();
  return {
    on(cb: (p: T) => void): Unsubscribe { s.add(cb); return () => s.delete(cb); },
    emit(p: T) { for (const fn of s) try { fn(p) } catch (e) { console.error('[marwa:hook]', e) } }
  };
}

export type ComponentCtx = {
  app: App;
  el: HTMLElement | DocumentFragment;
  scope: any;
  name?: string;
};

export type MarwaHooks = {
  onInit:               ReturnType<typeof createHook<App>>;
  onComponentMount:     ReturnType<typeof createHook<ComponentCtx>>;
  onComponentUnmount:   ReturnType<typeof createHook<ComponentCtx>>;
};

/* ---------------- Directives & Bridges ---------------- */

export type EvaluateFn = (code: string, scope: any) => any;
export type EffectFn = (runner: () => void) => void;

export type DirectiveMount = (args: {
  el: HTMLElement;
  expr: string;
  evaluate: EvaluateFn;
  effect: EffectFn;
  scope: any;
  app: App;
}) => void | (() => void);

export type DirectiveMap = Record<string, DirectiveMount>;
export type ServiceMap   = Record<string | symbol, any>;

/* ---------------- Plugin Contracts ---------------- */

export type MarwaPlugin = {
  /** Unique, stable plugin name (used for dedupe & deps). */
  name: string;

  /** Optional dependencies (by name). */
  deps?: string[];

  /** Optional directives contributed by this plugin. */
  directives?: DirectiveMap;

  /** Optional services (globals) provided by this plugin. */
  provides?: ServiceMap;

  /** Called once when the plugin is installed. */
  setup?: (app: App) => void | Promise<void>;
};

/** Lazy factory (code-split). */
export type MarwaPluginFactory = () => Promise<MarwaPlugin> | MarwaPlugin;

/** Authoring helper (zero runtime cost). */
export function definePlugin(p: MarwaPlugin) { return p }

/* ---------------- App Interface ---------------- */

export type App = {
  // Plugin API
  use: (pluginOrFactory: MarwaPlugin | MarwaPluginFactory) => Promise<App>;
  register: (name: string, factory: MarwaPluginFactory) => void;
  hasPlugin: (name: string) => boolean;

  // DI / services
  provide: (key: any, value: any) => void;
  inject: (key: any, fallback?: any) => any;

  // Directives
  directive: (name: string, mount: DirectiveMount) => void;
  _resolveDirective: (name: string) => DirectiveMount | undefined;

  // Hooks
  hooks: MarwaHooks;

  // Bridges (wired by runtime)
  _evaluate: EvaluateFn;
  _effect: EffectFn;

  // Internal registries (visible for advanced plugins)
  _directives: Map<string, DirectiveMount>;
  _services: Map<any, any>;

  // Plugin state
  _installed: Set<string>;
  _pending: Map<string, Promise<void>>;
  _registry: Map<string, MarwaPluginFactory>;
};

/* ---------------- Factories ---------------- */

export function createHooks(): MarwaHooks {
  return {
    onInit: createHook<App>(),
    onComponentMount: createHook<ComponentCtx>(),
    onComponentUnmount: createHook<ComponentCtx>(),
  };
}

export function createDirectiveRegistry() {
  return new Map<string, DirectiveMount>();
}

export function createServiceRegistry() {
  return new Map<any, any>();
}

/* ---------------- Dependency Resolver ---------------- */

async function resolveDeps(app: App, plugin: MarwaPlugin, stack: string[] = []) {
  if (!plugin.deps || plugin.deps.length === 0) return;

  for (const dep of plugin.deps) {
    if (app._installed.has(dep)) continue;
    if (stack.includes(dep)) {
      throw new Error(`[marwa:plugin] Circular dependency: ${[...stack, dep].join(' -> ')}`);
    }
    // If dep is currently pending, wait for it
    const pending = app._pending.get(dep);
    if (pending) { await pending; continue; }

    // If dep found in registry, load & install it
    const factory = app._registry.get(dep);
    if (!factory) {
      throw new Error(`[marwa:plugin] "${plugin.name}" requires "${dep}" — not installed and no factory registered.`);
    }

    const task = (async () => {
      const depPlugin = await factory();
      if (!depPlugin || depPlugin.name !== dep) {
        throw new Error(`[marwa:plugin] Factory for "${dep}" did not return a plugin with matching name.`);
      }
      await installPlugin(app, depPlugin, [...stack, plugin.name]);
    })();

    app._pending.set(dep, task);
    await task;
    app._pending.delete(dep);
  }
}

/* ---------------- Installer & use() ---------------- */

export async function installPlugin(app: App, plug: MarwaPlugin, stack: string[] = []) {
  const name = plug.name || '(anonymous)';
  if (app._installed.has(name)) return; // dedupe

  // Resolve & install dependencies first
  await resolveDeps(app, plug, stack);

  // register services
  if (plug.provides) {
    for (const [k, v] of Object.entries(plug.provides)) {
      app._services.set(k, v);
    }
  }
  // register directives
  if (plug.directives) {
    for (const [n, d] of Object.entries(plug.directives)) {
      app._directives.set(n, d);
    }
  }
  // call setup
  if (plug.setup) {
    await plug.setup(app);
  }

  app._installed.add(name);
}

function isFactory(x: any): x is MarwaPluginFactory {
  // A factory is a function that returns a plugin or promise;
  // A plugin is an object with a .name string.
  return typeof x === 'function' && (x.name === '' || !('name' in x));
}

export async function usePlugin(app: App, p: MarwaPlugin | MarwaPluginFactory): Promise<App> {
  if (isFactory(p)) {
    // Anonymous factory: load & install
    const key = '__lazy_' + Math.random().toString(36).slice(2);
    const task = (async () => {
      const plugin = await (p as MarwaPluginFactory)();
      if (!plugin || typeof plugin.name !== 'string') {
        throw new Error('[marwa:plugin] Lazy factory did not return a valid plugin object');
      }
      await installPlugin(app, plugin);
    })();
    app._pending.set(key, task);
    await task;
    app._pending.delete(key);
    return app;
  }

  const plug = p as MarwaPlugin;
  if (!plug || !plug.name) throw new Error('[marwa:plugin] invalid plugin — missing "name"');

  const existing = app._pending.get(plug.name);
  if (existing) { await existing; return app; }

  const task = installPlugin(app, plug);
  app._pending.set(plug.name, task);
  await task;
  app._pending.delete(plug.name);
  return app;
}
