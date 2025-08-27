// router.plugin.ts — MarwaJS Router (full updated)
import { definePlugin, type MarwaPlugin, type App as PluginApp } from './plugins';
import { mountLazyComponent, type AppInstance } from './runtime';

type Dict<T = any> = Record<string, T>;

/* ===================== Types ===================== */
export type RawLocation =
  | string
  | {
      path: string;
      query?: Dict<string | number | boolean | (string | number | boolean)[]>;
      hash?: string;
      replace?: boolean;
    };

export interface RouteRecord {
  path: string;
  name?: string;
  component?: any | (() => Promise<any>);
  redirect?: string | ((to: RouteLocation) => string);
  children?: RouteRecord[];
  guard?: NavigationGuard | NavigationGuard[];
  middlewares?: Middleware | Middleware[];
  meta?: Dict;
}

export interface MatchedRecord {
  record: RouteRecord;
  params: Dict<string>;
}

export interface RouteLocation {
  fullPath: string;
  path: string;
  query: Dict<(string | string[])>;
  hash: string;
  params: Dict<string>;
  name?: string;
  meta: Dict;
  matched: MatchedRecord[];
}

export type RedirectTo = string | RawLocation;
export type NavigationOutcome =
  | void
  | false
  | RedirectTo
  | Promise<void | false | RedirectTo>;

export type NavigationGuard = (to: RouteLocation, from: RouteLocation) => NavigationOutcome;
export type Middleware = (to: RouteLocation, from: RouteLocation, ctx: Dict) => NavigationOutcome;
export type AfterHook = (to: RouteLocation, from: RouteLocation) => void | Promise<void>;

export interface RouterOptions {
  routes: RouteRecord[];
  mode?: 'hash' | 'history';
  base?: string;
  /** Optional custom renderer to decouple from runtime or avoid circular imports. */
  viewRenderer?: (host: HTMLElement, route: RouteLocation, app: PluginApp) => Promise<void> | void;
}

export interface Router {
  // state
  get current(): RouteLocation;
  subscribe(fn: (route: RouteLocation) => void): () => void;

  // nav
  push(to: RawLocation): Promise<void>;
  replace(to: RawLocation): Promise<void>;
  back(): void;

  // hooks
  beforeEach(fn: NavigationGuard): () => void;
  afterEach(fn: AfterHook): () => void;
  use(fn: Middleware): () => void;

  // utils
  resolve(to: RawLocation): RouteLocation;
  match(pathname: string): RouteLocation | null;

  // lifecycle
  mount(): void;
  destroy(): void;

  // internal
  _render?: (host: HTMLElement, r: RouteLocation, a: PluginApp) => Promise<void> | void;
}

/* ===================== Tiny store ===================== */
function writable<T>(value: T) {
  let v = value;
  const subs = new Set<(v: T) => void>();
  return {
    get(): T { return v; },
    set(next: T) {
      if (next === v) return;
      v = next;
      subs.forEach((fn) => { try { fn(v) } catch(e) { console.error('[marwa:router:sub]', e); } });
    },
    subscribe(fn: (v: T) => void) { subs.add(fn); return () => subs.delete(fn); },
  };
}

/* ===================== Path compiler ===================== */
interface Compiled {
  full: string;
  re: RegExp;
  keys: string[];
  record: RouteRecord;
}

function normalize(path: string): string {
  if (!path) return '/';
  if (path[0] !== '/') path = '/' + path;
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

function compilePath(path: string): { re: RegExp; keys: string[] } {
  const keys: string[] = [];
  let pattern = path
    .replace(/([.+*?=^${}()[\]|\\])/g, '\\$1')
    .replace(/\/:([A-Za-z0-9_]+)(\?)?/g, (_, key, optional) => {
      keys.push(key);
      return optional ? '(?:/([^/]+))?' : '/([^/]+)';
    })
    .replace(/\/\*(?!\*)/g, '/(.+)')
    .replace(/\*\*/g, '.*');
  pattern = '^' + pattern + '/?$';
  return { re: new RegExp(pattern), keys };
}

function buildTable(records: RouteRecord[], parent = '', out: Compiled[] = []): Compiled[] {
  for (const r of records) {
    const full = normalize(parent + '/' + (r.path || ''));
    const { re, keys } = compilePath(full);
    out.push({ full, re, keys, record: r });
    if (r.children?.length) buildTable(r.children, full, out);
  }
  return out;
}

/* ===================== Query helpers ===================== */
function parseQuery(qs: string): Dict<(string | string[])> {
  const out: Dict<any> = {};
  if (!qs) return out;
  const s = qs[0] === '?' ? qs.slice(1) : qs;
  for (const part of s.split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    const key = decodeURIComponent(k.replace(/\+/g, '%20'));
    const val = decodeURIComponent(v.replace(/\+/g, '%20'));
    if (key in out) {
      const prev = out[key];
      out[key] = Array.isArray(prev) ? [...prev, val] : [prev, val];
    } else out[key] = val;
  }
  return out;
}

function stringifyQuery(obj?: Dict<any>): string {
  if (!obj) return '';
  const parts: string[] = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v == null) continue;
    const key = encodeURIComponent(k);
    if (Array.isArray(v)) for (const item of v) parts.push(`${key}=${encodeURIComponent(String(item))}`);
    else parts.push(`${key}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/* ===================== Router core ===================== */
// render serialization to avoid races
let _renderLock: Promise<void> = Promise.resolve();

function callUnmount(u: any) {
  try {
    if (!u) return;
    if (typeof u === 'function') return u();
    if (u && typeof u.unmount === 'function') return u.unmount();
  } catch (e) {
    console.error('[router] unmount error', e);
  }
}
function captureUnmountFrom(host: HTMLElement, candidate: any) {
  if (typeof candidate === 'function') { (host as any)._mwUnmount = candidate; return; }
  if (candidate && typeof candidate.unmount === 'function') {
    (host as any)._mwUnmount = candidate.unmount.bind(candidate);
    return;
  }
  const maybe = (host as any)._unmount;
  if (typeof maybe === 'function') { (host as any)._mwUnmount = maybe; return; }
  (host as any)._mwUnmount = undefined;
}

function createRouterCore(options: RouterOptions, app: PluginApp): Router {
  const mode = options.mode ?? 'hash';
  const base = normalize(options.base || '/');
  const table = buildTable(options.routes);

  const getLocation = (): { path: string; query: string; hash: string } => {
    if (mode === 'hash') {
      const h = location.hash || '#/';
      const i = h.indexOf('?');
      const j = h.indexOf('#', 1);
      const path = normalize(decodeURI(h.slice(1, i >= 0 ? i : j >= 0 ? j : undefined)));
      const qs = i >= 0 ? h.slice(i, j >= 0 ? j : undefined) : '';
      const hash = j >= 0 ? h.slice(j) : '';
      return { path, query: qs, hash };
    } else {
      const url = new URL(location.href);
      let path = url.pathname;
      if (base !== '/' && path.startsWith(base)) path = path.slice(base.length) || '/';
      return { path: normalize(decodeURI(path)), query: url.search, hash: url.hash };
    }
  };

  const setLocation = (to: RouteLocation, replace = false) => {
    const url = to.path + stringifyQuery(to.query) + (to.hash || '');
    if (mode === 'hash') {
      const target = '#' + url;
      replace ? history.replaceState(null, '', target) : history.pushState(null, '', target);
    } else {
      const full = base === '/' ? url : base + (url === '/' ? '' : url);
      replace ? history.replaceState(null, '', full) : history.pushState(null, '', full);
    }
  };

  function matchPath(pathname: string): MatchedRecord[] {
    const list: MatchedRecord[] = [];
    for (const c of table) {
      const m = c.re.exec(pathname);
      if (!m) continue;
      const params: Dict<string> = {};
      c.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] || '')));
      list.push({ record: c.record, params });
    }
    return list;
  }

  function finalizeRoute(
    matched: MatchedRecord[] | null,
    query: Dict<(string | string[])> = {},
    hash = ''
  ): RouteLocation {
    if (!matched || matched.length === 0) {
      const fullPath = '/' + stringifyQuery(query) + hash;
      return { fullPath, path: '/', query, hash, params: {}, meta: {}, matched: [] };
    }
    const leaf = matched[matched.length - 1];
    const params = Object.assign({}, ...matched.map((m) => m.params));
    const meta   = Object.assign({}, ...matched.map((m) => m.record.meta || {}));
    const name   = leaf.record.name;

    let p = normalize(leaf.record.path || '/');
    p = p.replace(/:([A-Za-z0-9_]+)/g, (_, k) => encodeURIComponent(params[k] ?? ''));
    const path = p;
    const fullPath = path + stringifyQuery(query) + hash;
    return { fullPath, path, query, hash, params, meta, name, matched };
  }

  function resolveFromLocation(): RouteLocation {
    const { path, query, hash } = getLocation();
    const match = matchPath(path);
    const queryObj = parseQuery(query);
    return finalizeRoute(match, queryObj, hash || '');
  }

  function normalizeTo(to: RawLocation): RouteLocation {
    if (typeof to === 'string') {
      const u = new URL(to, 'http://x');
      const q = parseQuery(u.search);
      const hash = u.hash || '';
      const path = normalize(u.pathname);
      const match = matchPath(path);
      return finalizeRoute(match, q, hash);
    }
    const path = normalize(to.path);
    const q = parseQuery(stringifyQuery(to.query));
    const hash = to.hash ? (to.hash.startsWith('#') ? to.hash : '#' + to.hash) : '';
    const match = matchPath(path);
    return finalizeRoute(match, q, hash);
  }

  const state = writable<RouteLocation>(resolveFromLocation());
  const globalGuards = new Set<NavigationGuard>();
  const globalMws = new Set<Middleware>();
  const afterHooks = new Set<AfterHook>();

  async function runPipeline(to: RouteLocation, from: RouteLocation): Promise<NavigationOutcome> {
    const leaf = to.matched[to.matched.length - 1]?.record;
    if (leaf?.redirect) {
      const target = typeof leaf.redirect === 'function' ? leaf.redirect(to) : leaf.redirect;
      return target;
    }
    const guards: NavigationGuard[] = [...globalGuards];
    for (const m of to.matched) {
      const g = m.record.guard;
      if (g) Array.isArray(g) ? guards.push(...g) : guards.push(g);
    }
    for (const g of guards) {
      const res = await g(to, from);
      if (res === false || typeof res === 'string' || typeof res === 'object') return res as any;
    }
    const ctx: Dict = {};
    const mws: Middleware[] = [...globalMws];
    for (const m of to.matched) {
      const w = m.record.middlewares;
      if (w) Array.isArray(w) ? mws.push(...w) : mws.push(w);
    }
    for (const mw of mws) {
      const res = await mw(to, from, ctx);
      if (res === false || typeof res === 'string' || typeof res === 'object') return res as any;
    }
    return;
  }

  async function navigate(to: RawLocation, replace?: boolean) {
    const target = normalizeTo(to);
    const from = state.get();
    const outcome = await runPipeline(target, from);

    if (outcome === false) return;
    if (typeof outcome === 'string' || typeof outcome === 'object') {
      await navigate(outcome as any, !!(typeof outcome === 'object' && (outcome as any).replace));
      return;
    }

    setLocation(target, !!replace);
    const prev = state.get();
    state.set(target);
    for (const hook of afterHooks) Promise.resolve(hook(target, prev)).catch(() => {});
  }

  let popHandler: ((e: Event) => void) | null = null;

  function onPop() {
    const next = resolveFromLocation();
    const prev = state.get();
    runPipeline(next, prev)
      .then((outcome) => {
        if (outcome === false) { setLocation(prev, true); return; }
        if (typeof outcome === 'string' || typeof outcome === 'object') { navigate(outcome as any); return; }
        state.set(next);
        for (const hook of afterHooks) Promise.resolve(hook(next, prev)).catch(() => {});
      })
      .catch(() => {});
  }

  const router: Router = {
    get current() { return state.get(); },
    subscribe(fn) { return state.subscribe(fn); },
    async push(to)    { await navigate(to, false); },
    async replace(to) { await navigate(to, true);  },
    back() { history.back(); },
    beforeEach(fn) { globalGuards.add(fn); return () => globalGuards.delete(fn); },
    afterEach(fn)  { afterHooks.add(fn);   return () => afterHooks.delete(fn); },
    use(fn)        { globalMws.add(fn);    return () => globalMws.delete(fn); },
    resolve(to)    { return normalizeTo(to); },
    match(pathname){ const m = matchPath(normalize(pathname)); return m.length? finalizeRoute(m, {}, ''): null; },
    mount() {
      if (!popHandler) {
        popHandler = onPop;
        if (mode === 'hash') {
          window.addEventListener('hashchange', popHandler);
          if (!location.hash) location.replace('#/'); // ensure initial hash
        } else {
          window.addEventListener('popstate', popHandler);
        }
      }
      state.set(resolveFromLocation());
    },
    destroy() {
      if (!popHandler) return;
      if (mode === 'hash') window.removeEventListener('hashchange', popHandler);
      else window.removeEventListener('popstate', popHandler);
      popHandler = null;
    },
  };

  /* -------- Default renderer used by <RouterView/> -------- */
  const defaultRenderer = async (host: HTMLElement, r: RouteLocation, a: PluginApp) => {
    _renderLock = _renderLock.then(async () => {
      // Unmount previous
      callUnmount((host as any)._mwUnmount);
      (host as any)._mwUnmount = undefined;
      host.innerHTML = '';

      // Matched
      const leaf = r.matched[r.matched.length - 1]?.record;
      if (!leaf) { host.textContent = 'Not Found'; return; }

      let comp = leaf.component;

      // STRING SFC id
      if (typeof comp === 'string') {
        if (typeof mountLazyComponent === 'function') {
          const hooksOrFn = await mountLazyComponent(
            comp,
            host,
            a as unknown as AppInstance,
            {},
            null
          );
          captureUnmountFrom(host, hooksOrFn);
        } else {
          host.textContent = `Component: ${comp}`;
        }
        return;
      }

      // LAZY factory
      if (typeof comp === 'function') {
        try {
          const mod = await comp();
          comp = mod?.default ?? mod;
          if (typeof comp === 'string') {
            if (typeof mountLazyComponent === 'function') {
              const hooksOrFn = await mountLazyComponent(
                comp,
                host,
                a as unknown as AppInstance,
                {},
                null
              );
              captureUnmountFrom(host, hooksOrFn);
            } else {
              host.textContent = `Component: ${comp}`;
            }
            return;
          }
        } catch (e) {
          console.error('[router] lazy component load failed:', e);
          host.textContent = 'Failed to load component';
          return;
        }
      }

      // render() / HTMLElement / string fallbacks
      if (comp && typeof (comp as any).render === 'function') {
        await (comp as any).render(host, a, r);
        captureUnmountFrom(host, (host as any)._unmount);
        return;
      }
      if (comp instanceof HTMLElement) { host.appendChild(comp); return; }
      if (typeof comp === 'string') { host.innerHTML = comp; return; }

      host.textContent = 'Component';
    }).catch(err => console.error('[router] render lock error', err));

    await _renderLock;
  };

  router._render = options.viewRenderer || defaultRenderer;
  return router;
}

/* ===================== Public helpers ===================== */
export function requireAuth(getIsAuthed: () => boolean, redirectTo = '/login'): Middleware {
  return () => { if (!getIsAuthed()) return redirectTo; };
}
export function blockGuests(getIsAuthed: () => boolean): NavigationGuard {
  return () => (getIsAuthed() ? undefined : false);
}

/* ===================== Components ===================== */
export function RouterLink(
  props: { to: RawLocation; replace?: boolean },
  ctx: { app: PluginApp }
) {
  const router = ctx.app.inject('router') as Router;
  const a = document.createElement('a');
  const href = typeof props.to === 'string' ? props.to : (props.to as any)?.path ?? '/';
  a.setAttribute('href', href);

  // debounce to avoid double-push races
  let pending = false;
  a.addEventListener('click', async (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if ((e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey || (e as MouseEvent).shiftKey || (e as MouseEvent).altKey) return;
    e.preventDefault();
    if (pending) return;
    pending = true;
    try {
      props.replace ? await router.replace(props.to) : await router.push(props.to);
    } finally {
      pending = false;
    }
  });

  return a;
}

export function RouterView(_props: {}, ctx: { app: PluginApp }) {
  const router = ctx.app.inject('router') as Router;
  const host = document.createElement('div');

  const render = router._render!;
  const doRender = () => render(host, router.current, ctx.app);

  doRender();
  const unsub = router.subscribe(() => doRender());

  (host as any)._unmount = () => unsub();
  return host;
}

/* ===================== Plugin ===================== */
export function RouterPlugin(options: RouterOptions): MarwaPlugin {
  return definePlugin({
    name: 'router',
    async setup(app) {
      const router = createRouterCore(options, app);

      // DI services
      app.provide('router', router);
      app.provide('$route', {
        get value() { return router.current; },
        subscribe: router.subscribe,
      });

      // Register components for compiler
      const reg = (app as any)._components || ((app as any)._components = {});
      reg['RouterLink'] = RouterLink; reg['ROUTERLINK'] = RouterLink;
      reg['RouterView'] = RouterView; reg['ROUTERVIEW'] = RouterView;

      // Mount router when app initializes
      app.hooks.onInit.on(() => { router.mount(); });
    },
  });
}
