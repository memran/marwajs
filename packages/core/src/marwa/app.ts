import type { Component, SetupContext, AsyncComponentLoader } from './dom';
import { defineComponent, mountComponent } from './dom';

type LazyMap = Record<string, () => Promise<any>>;
type Plugin = ((app: App) => void | Promise<void>) | { install: (app: App) => void | Promise<void> };

export interface App {
  component(name: string, c: Component | AsyncComponentLoader): void;
  getComponent(name: string): Component | AsyncComponentLoader | undefined;
  use(p: Plugin): App;
  mount(selector: string): void;

  provide<T>(token: string, value: T): void;
  inject<T>(token: string): T | undefined;

  _ctx: SetupContext['app'];
  _router?: { mount: (selector: string) => void };

  __hooks: {
    beforeMount: Set<() => void>;
    mounted: Set<() => void>;
    beforeUnmount: Set<() => void>;
    unmounted: Set<() => void>;
  };
}

const viteGlob: undefined | ((p: string, o?: any) => Record<string, any>) = (import.meta as any).glob;

function toPascal(s: string){ return s.replace(/(^|[-_/])([a-z])/g,(_,__,c)=>c.toUpperCase()).replace(/[-_/]/g,''); }
function fileName(p?: string){ if(!p) return ''; const b=p.split(/[\\/]/).pop()||''; return b.replace(/\.\w+$/,''); }

export function createApp(opts?: { components?: LazyMap; root?: Component | AsyncComponentLoader; }): App {
  const registry = new Map<string, Component | AsyncComponentLoader>();
  const services = new Map<string, any>();

  const lazyGlobs: LazyMap = opts?.components ?? (viteGlob ? (viteGlob('/components/**/*.marwa') as LazyMap) : {});
  for (const [path, rawLoader] of Object.entries(lazyGlobs)) {
    const base = fileName(path);
    const pascal = toPascal(base);
    const wrapped: AsyncComponentLoader = async () => {
      const mod = await (rawLoader as any)(); const comp = (mod as any)?.default as Component | undefined;
      if (comp?.name) { if (!registry.has(comp.name)) registry.set(comp.name, comp); if (!registry.has(comp.name.toUpperCase())) registry.set(comp.name.toUpperCase(), comp); }
      return { default: comp! };
    };
    [base, base.toUpperCase(), pascal, pascal.toUpperCase()].forEach(n => { if (!registry.has(n)) registry.set(n, wrapped); });
  }

  function resolveRoot(): Component | AsyncComponentLoader | null {
    if (opts?.root) return opts.root;
    if (!viteGlob) return null;
    const eager = viteGlob('/App.marwa', { eager: true }) || {};
    const lazy  = viteGlob('/App.marwa') || {};
    if ((eager as any)['/App.marwa']?.default) return (eager as any)['/App.marwa'].default as Component;
    if (typeof (lazy as any)['/App.marwa'] === 'function') return (lazy as any)['/App.marwa'] as AsyncComponentLoader;
    return null;
  }

  const app: App = {
    component(name, c){ registry.set(name, c); registry.set(name.toUpperCase(), c); },
    getComponent(tag){
      const direct = registry.get(tag); if (direct) return direct;
      const pascal = toPascal(tag); return registry.get(pascal) || registry.get(pascal.toUpperCase());
    },
    use(p: Plugin){ if (typeof p === 'function') { p(app); return app; } if (p && typeof (p as any).install === 'function') { (p as any).install(app); return app; } return app; },
    mount(selector: string){
      if (app._router) { app._router.mount(selector); return; }
      const el = document.querySelector(selector); if (!el) throw new Error(`mount target not found: ${selector}`);

      app.__hooks.beforeMount.forEach(fn => { try { fn(); } catch {} });

      const root = resolveRoot();
      if (root) {
        void mountComponent(el, root as any, app._ctx).then(() => {
          app.__hooks.mounted.forEach(fn => { try { fn(); } catch {} });
        });
      } else {
        (el as HTMLElement).innerHTML = `<div style="padding:16px;font:14px/1.4 system-ui">
          <strong>MarwaJS</strong><br/>
          No router and <code>/App.marwa</code> not found at project root.<br/>
          Create <code>App.marwa</code> next to your <code>index.html</code> or install the router.
        </div>`;
        app.__hooks.mounted.forEach(fn => { try { fn(); } catch {} });
      }
    },

    provide(token, value){ services.set(token, value); },
    inject(token){ return services.get(token); },

    _ctx: {
      registerComponent(name: string, c: Component | AsyncComponentLoader){ app.component(name, c); },
      getComponent(name: string){ return app.getComponent(name); },
      inject<T>(token: string){ return services.get(token); },
      provide<T>(token: string, value: T){ services.set(token, value); }
    },

    __hooks: {
      beforeMount: new Set(), mounted: new Set(), beforeUnmount: new Set(), unmounted: new Set()
    }
  };

  return app;
}

export function onAppBeforeMount(app: App, cb: () => void){ app.__hooks.beforeMount.add(cb); }
export function onAppMounted(app: App, cb: () => void){ app.__hooks.mounted.add(cb); }
export function onAppBeforeUnmount(app: App, cb: () => void){ app.__hooks.beforeUnmount.add(cb); }
export function onAppUnmounted(app: App, cb: () => void){ app.__hooks.unmounted.add(cb); }

export function inlineComponent(name: string, html: string): Component { return defineComponent({ name, template: html }); }
