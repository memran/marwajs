// src/marwa/router.ts
import type { Component, AsyncComponentLoader } from './dom';
import { mountComponent } from './dom';
import { signal, type Signal } from './reactivity';
import type { App } from './app';
import { devEmit } from './devtools';

export interface RouteRecord {
  path: string;
  component?: AsyncComponentLoader | { default?: Component } | Component;
  eager?: Component;
  meta?: Record<string, any>;
  children?: RouteRecord[];
}

export interface Router {
  install(app: App): void;
  mount(selector: string): void;
  push(path: string): void;
  replace(path: string): void;
  currentPath(): string;
  beforeEach(fn: Middleware): void;
  afterEach(fn: AfterGuard): void;
}

export type Middleware =
  (ctx: NavContext) =>
    | void
    | boolean
    | string
    | { path: string }
    | Promise<void | boolean | string | { path: string }>;

export type AfterGuard = (to: MatchedRoute, from: MatchedRoute) => void | Promise<void>;

export interface NavContext {
  to: MatchedRoute;
  from: MatchedRoute;
  router: Router;
  redirect: (p: string) => { path: string };
  cancel: () => boolean;
}

export interface MatchedRoute {
  path: string;
  meta: Record<string, any>;
  matched: { path: string; meta: Record<string, any> }[];
}

/* ------------- reactive route state ------------- */
const _rPath: Signal<string> = signal('/');
const _rParams: Signal<Record<string, string>> = signal({});
const _rQuery: Signal<Record<string, string>> = signal({});
const _rMeta: Signal<Record<string, any>> = signal({});
const _rMatched: Signal<{ path: string; meta: Record<string, any> }[]> = signal([]);

export function useRoute() {
  return {
    get path() { return _rPath.value; },
    get params() { return _rParams.value; },
    get query() { return _rQuery.value; },
    get meta() { return _rMeta.value; },
    get matched() { return _rMatched.value; },
  };
}

/* ------------- utils ------------- */
function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!qs) return out;
  for (const part of qs.split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}
function makeUrlPath(path: string, query: Record<string, string>): string {
  const qs = Object.keys(query).length
    ? '?' + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';
  return path + qs;
}
function normalizeBase(b: string) {
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b += '/';
  return b;
}
function readBaseFromDom(): string | null {
  try {
    const el = document.querySelector('base[href]') as HTMLBaseElement | null;
    if (!el) return null;
    const href = el.getAttribute('href') || '/';
    try { return new URL(href, location.origin).pathname || '/'; }
    catch { return href || '/'; }
  } catch { return null; }
}

/* ------------- createRouter ------------- */
export function createRouter(opts?: {
  routes?: RouteRecord[];                    // SPA if provided
  mode?: 'hash' | 'history';
  base?: string;
  files?: Record<string, () => Promise<any>>; // pages glob (host may pass it)
}): Router {
  let app: App | null = null;
  let rootEl: Element | null = null;

  /* built-ins */
  const RouterLink: Component = {
    name: 'RouterLink',
    template: `<a href="" @click="go(event)"><slot></slot></a>`,
    setup({ ctx }) {
      ctx.go = (e: MouseEvent) => {
        e.preventDefault();
        const a = e.currentTarget as HTMLAnchorElement;
        const to = (a.getAttribute('to') || a.getAttribute('href') || '/').replace(/^#?/, '');
        router.push(to.startsWith('/') ? to : `/${to}`);
      };
    }
  };
  const RouterOutlet: Component = { name: 'RouterOutlet', template: `<div data-router-outlet=""></div>` };

  /* mode/base */
  const mode = opts?.mode ?? 'hash';
  const base = normalizeBase(opts?.base ?? (mode === 'history' ? (readBaseFromDom() || '/') : '/'));

  /* tree model */
  type Seg = { t: 'static'; v: string } | { t: 'param'; n: string } | { t: 'splat'; n: string };
  interface Node { seg?: Seg; fullPath: string; record?: RouteRecord; children: Node[]; }
  const root: Node = { fullPath: '/', children: [] };

  /* pages scan (root-only). If host passed files, prefer them. */
  const viteGlob = (import.meta as any).glob as (p: string, o?: any) => Record<string, any> | undefined;
  const pageGlobs = opts?.files ?? (viteGlob ? (viteGlob('/pages/**/*.marwa') as Record<string, () => Promise<any>>) : {});
  const hasPages = Object.keys(pageGlobs).length > 0;

  /* decide mode */
  const manualRoutes = Array.isArray(opts?.routes) ? opts!.routes! : [];
  const SPA = manualRoutes.length > 0;
  const PROGRESSIVE = !SPA && hasPages;

  /* build route tree */
  if (SPA) manualRoutes.forEach(r => addRouteRecord(root, r, '/'));

  if (PROGRESSIVE) {
    for (const [file, loader] of Object.entries(pageGlobs)) {
      const full = fileRoutePath(file);
      addFullPath(root, toSegments(full), { path: full, component: loader as any });
    }
  }

  /* hint when router enabled but neither pages nor SPA routes exist */
  if (!SPA && !PROGRESSIVE) {
    const Hint: Component = {
      name: 'MarwaRouterHint',
      template: `<div style="padding:16px;font:14px/1.4 system-ui">
        <strong>MarwaJS Router</strong><br/>
        No <code>pages/</code> found and no <code>routes</code> passed.<br/>
        Declare routes: <code>createRouter({ routes:[{ path:'/', component: ()=>import('/App.marwa') }] })</code>
      </div>`
    };
    root.record = { path: '/', eager: Hint };
  }

  /* guards + state */
  const beforeGuards: Middleware[] = [];
  const afterGuards: AfterGuard[] = [];
  let current: MatchedRoute = { path: '/', meta: {}, matched: [] };
  let isNavigating = false;
  let suppressNextHash = false;

  /* router impl */
  const router: Router = {
    install(_app: App) {
      app = _app;
      app.component('RouterLink', RouterLink);
      app.component('RouterOutlet', RouterOutlet);
      (app as any)._router = { mount: (sel: string) => router.mount(sel) };
    },
    mount(selector: string) {
      if (!app) throw new Error('[Marwa:router] call app.use(createRouter()) before mount.');
      rootEl = document.querySelector(selector);
      if (!rootEl) throw new Error(`Router mount target not found: ${selector}`);

      const first = initPath(mode, base);
      void navigate(first.full, { replace: true, external: true, parsed: first });

      if (mode === 'history') {
        window.addEventListener('popstate', () => {
          const p = initPath(mode, base);
          void navigate(p.full, { external: true, replace: true, parsed: p });
        });
      } else {
        window.addEventListener('hashchange', () => {
          if (suppressNextHash) { suppressNextHash = false; return; }
          const p = initPath(mode, base);
          void navigate(p.full, { external: true, replace: true, parsed: p });
        });
      }
    },
    push(p: string) { void navigate(p); },
    replace(p: string) { void navigate(p, { replace: true }); },
    currentPath: () => _rPath.value,
    beforeEach(fn) { beforeGuards.push(fn); },
    afterEach(fn) { afterGuards.push(fn); }
  };

  return router;

  /* ------------- navigation/render ------------- */
  type ParsedURL = { full: string; path: string; query: Record<string, string> };

  function parseURL(target: string): ParsedURL {
    if (mode === 'history') {
      const [p, q] = target.split('?');
      return { full: target, path: p || '/', query: parseQuery(q || '') };
    }
    const raw = target.startsWith('#') ? target.slice(1) : target;
    const [p, q] = raw.split('?');
    return { full: raw, path: p || '/', query: parseQuery(q || '') };
  }

  function initPath(m: 'hash'|'history', b: string): ParsedURL {
    if (m === 'history') {
      const p = location.pathname.startsWith(b) ? (location.pathname.slice(b.length) || '/') : '/';
      const q = location.search.replace(/^\?/, '');
      return { full: makeUrlPath(p, parseQuery(q)), path: p, query: parseQuery(q) };
    } else {
      const h = location.hash.replace(/^#/, '') || '/';
      const [p, q] = h.split('?');
      return { full: h, path: p || '/', query: parseQuery(q || '') };
    }
  }

  function updateURL(pathWithQuery: string, replace = false, beforeHashWrite?: () => void) {
    if (mode === 'history') {
      const url = base + (pathWithQuery.startsWith('/') ? pathWithQuery.slice(1) : pathWithQuery);
      if (replace) history.replaceState({}, '', url);
      else history.pushState({}, '', url);
    } else {
      beforeHashWrite?.();
      const h = pathWithQuery.startsWith('#') ? pathWithQuery : '#' + pathWithQuery;
      if (replace) {
        const u = new URL(location.href);
        u.hash = h.slice(1);
        history.replaceState({}, '', u.toString());
      } else {
        location.hash = h;
      }
    }
  }

  async function navigate(target: string, opts?: { replace?: boolean; external?: boolean; parsed?: ParsedURL }) {
    if (isNavigating) return;
    const parsed = opts?.parsed ?? parseURL(target);

    const match = matchChain(root, parsed.path);
    if (!match) return; // silent when no match

    const to: MatchedRoute = {
      path: match.chain[match.chain.length - 1].fullPath,
      meta: {},
      matched: match.chain.map(n => ({ path: n.fullPath, meta: {} }))
    };
    const from: MatchedRoute = current;

    isNavigating = true;
    try {
      const redirect = (p: string) => ({ path: p });
      const cancel = () => false;

      for (const g of beforeGuards) {
        const res = await g({ to, from, router, redirect, cancel });
        if (res === false) {
          if (opts?.external) updateURL(makeUrlPath(from.path, parsed.query), true, () => { suppressNextHash = true; });
          return;
        }
        if (typeof res === 'string') { await navigate(res, { replace: true }); return; }
        if (res && typeof res === 'object' && 'path' in res) { await navigate(res.path, { replace: true }); return; }
      }

      _rPath.value = parsed.path;
      _rParams.value = match.params;
      _rQuery.value = parsed.query;
      _rMeta.value = {};
      _rMatched.value = to.matched;
      current = to;

      if (!opts?.external) updateURL(makeUrlPath(parsed.path, parsed.query), !!opts?.replace);

      devEmit({ type: 'router:navigate', from: from.path, to: to.path });

      await renderChain(match.chain);

      for (const ag of afterGuards) { void ag(to, from); }
    } finally {
      isNavigating = false;
    }
  }

  async function renderChain(nodes: Node[]) {
    if (!rootEl || !app) return;
    const appCtx = app._ctx;
    let outlet: Element = rootEl;

    for (const n of nodes) {
      const rec = n.record; if (!rec) continue;

      const compOrLoader: Component | AsyncComponentLoader | undefined =
        rec.eager ? rec.eager :
        (typeof rec.component === 'function'
          ? (rec.component as AsyncComponentLoader)
          : (rec.component && typeof rec.component === 'object' && 'default' in (rec.component as any)
              ? async () => (rec.component as any)
              : undefined));

      if (!compOrLoader) continue;

      await mountComponent(outlet, compOrLoader as any, appCtx);
      const next = outlet.querySelector('[data-router-outlet]');
      if (next) outlet = next as Element;
    }
  }

  /* ------------- route tree helpers ------------- */
  function fileRoutePath(file: string): string {
    // '/pages/users/[id]/edit.marwa' -> '/users/:id/edit'
    const rel = file.replace(/^\/pages\//, '').replace(/\.marwa$/, '');
    const segs = rel.split('/').map(s => {
      const mStar = s.match(/^\[\.\.\.(.+)\]$/); if (mStar) return `:${mStar[1]}*`;
      const m = s.match(/^\[(.+)\]$/);          if (m) return `:${m[1]}`;
      return s.toLowerCase();
    });
    let p = '/' + segs.join('/');
    if (p === '/index' || p === '/home') p = '/';
    return p;
  }

  function addRouteRecord(parent: Node, rec: RouteRecord, parentPath: string) {
    const segs = toSegments(joinChild(parentPath, rec.path));
    addFullPath(parent, segs, rec);
    if (rec.children) {
      const at = walkNode(parent, segs);
      rec.children.forEach(c => addRouteRecord(at, c, at.fullPath));
    }
  }

  function addFullPath(parent: Node, segs: Seg[], rec: RouteRecord) {
    const at = walkNode(parent, segs);
    at.record = {
      path: at.fullPath,
      component: rec.component ?? at.record?.component,
      eager: rec.eager ?? at.record?.eager,
      meta: { ...(at.record?.meta || {}), ...(rec.meta || {}) },
      children: rec.children ?? at.record?.children
    };
  }

  function walkNode(parent: Node, segs: Seg[]): Node {
    let cur = parent;
    for (const s of segs) cur = findChild(cur, s) || createChild(cur, s);
    return cur;
  }
  function findChild(n: Node, s: Seg): Node | undefined { return n.children.find(c => segEq(c.seg!, s)); }
  function createChild(n: Node, s: Seg): Node {
    const fullPath = joinChild(n.fullPath, segToPattern(s));
    const child: Node = { seg: s, fullPath, children: [] };
    const idx = n.children.findIndex(c => orderOf(c.seg!) > orderOf(s));
    if (idx === -1) n.children.push(child); else n.children.splice(idx, 0, child);
    return child;
  }

  function toSegments(full: string): Seg[] {
    if (full === '/' || full === '') return [];
    return full.replace(/^\//, '').split('/').map(seg => {
      if (seg.startsWith(':')) {
        const name = seg.slice(1);
        if (name.endsWith('*')) return { t: 'splat', n: name.slice(0, -1) } as Seg;
        return { t: 'param', n: name } as Seg;
      }
      return { t: 'static', v: seg } as Seg;
    });
  }
  function segToPattern(s: Seg): string { return s.t === 'static' ? s.v : s.t === 'param' ? `:${s.n}` : `:${s.n}*`; }
  function segEq(a: Seg, b: Seg) { if (a.t !== b.t) return false; return a.t === 'static' ? a.v === (b as any).v : a.n === (b as any).n; }
  function orderOf(s: Seg) { return s.t === 'static' ? 0 : s.t === 'param' ? 1 : 2; }
  function joinChild(parentFull: string, child: string) {
    const p = parentFull.endsWith('/') ? parentFull.slice(0, -1) : parentFull;
    const c = child.startsWith('/') ? child.slice(1) : child;
    const full = (p === '' || p === '/') ? `/${c}` : `${p}/${c}`;
    return full.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  }

  function matchChain(root: Node, urlPath: string): { chain: Node[]; params: Record<string, string> } | null {
    const segs = urlPath.replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean);
    const params: Record<string, string> = {};
    const chain: Node[] = [];

    function dfs(node: Node, i: number): boolean {
      if (node.record) chain.push(node);
      if (i >= segs.length) return true;

      const part = segs[i];

      // static
      for (const ch of node.children)
        if (ch.seg?.t === 'static' && ch.seg.v === part)
          if (dfs(ch, i + 1)) return true;

      // param
      for (const ch of node.children)
        if (ch.seg?.t === 'param') {
          params[ch.seg.n] = part;
          if (dfs(ch, i + 1)) return true;
          delete params[ch.seg.n];
        }

      // splat
      for (const ch of node.children)
        if (ch.seg?.t === 'splat') {
          params[ch.seg.n] = segs.slice(i).join('/');
          if (dfs(ch, segs.length)) return true;
          delete params[ch.seg.n];
        }

      if (node.record) chain.pop();
      return false;
    }

    const ok = dfs(root, 0);
    if (!ok) return null;
    if (chain.length === 0) return null;
    return { chain, params };
  }
}
