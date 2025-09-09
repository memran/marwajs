import { mount as mountCmp } from './component';
import { applyPlugin } from './plugin'; // ✅ ESM import (no require)

export type App = {
  _container: HTMLElement | null;
  _router?: any;
  _plugins?: Set<any>;
  use: (arg: any) => App;
  mount: (target: string | HTMLElement, Root?: any) => Promise<void>;
};

export function createApp(): App {
  const app: App = {
    _container: null,
    _router: undefined,
    _plugins: new Set(),

    use(arg: any) {
      // Router instance (has .start)
      if (arg && typeof arg === 'object' && 'start' in arg) {
        this._router = arg; (arg as any)._app = this; return this;
      }
      // Plugin (has .install)
      if (arg && typeof arg.install === 'function') {
        applyPlugin(this as any, arg);
        return this;
      }
      return this;
    },

    async mount(target: string | HTMLElement, Root?: any) {
      const el = typeof target === 'string'
        ? (document.querySelector(target) as HTMLElement | null)
        : (target as HTMLElement | null);
      if (!el) throw new Error(`Marwa: mount target not found: ${target}`);
      this._container = el;

      // ROUTER MODE: mount App.marwa shell, then start router in its <RouterView/>
      if (this._router && typeof this._router.start === 'function') {
        let Shell = Root ?? null;
        if (!Shell) {
          const candidates = [
            '/src/App.marwa','/App.marwa','/src/app/App.marwa','/src/ui/App.marwa'
          ];
          for (const spec of candidates) {
            try {
              const mod: any = await import(/* @vite-ignore */ spec);
              Shell = mod?.default ?? mod;
              if (Shell) break;
            } catch {}
          }
        }
        if (Shell) mountCmp(Shell, el, {});
        const host =
          (el.querySelector('[data-marwa-router-view]') as HTMLElement | null) ?? el;
        await this._router.start(host);
        return;
      }

      // NO ROUTER: mount root (App.marwa or provided Root)
      let RootCmp = Root;
      if (!RootCmp) {
        const candidates = [
          '/src/App.marwa','/App.marwa','/src/app/App.marwa','/src/ui/App.marwa'
        ];
        for (const spec of candidates) {
          try {
            const mod: any = await import(/* @vite-ignore */ spec);
            RootCmp = mod?.default ?? mod;
            if (RootCmp) break;
          } catch {}
        }
      }
      if (RootCmp) { mountCmp(RootCmp, el, {}); return; }
      el.innerHTML = '';
      console.warn('Marwa: no router attached and no App.marwa found.');
    }
  };
  return app;
}
