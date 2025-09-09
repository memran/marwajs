import { mount as mountCmp } from './component';

/* ----------------------------- Types ----------------------------------- */

export type MiddlewareCtx = { to: string; from: string; app: any; params: Record<string, string> };
export type Middleware = (ctx: MiddlewareCtx, next: () => Promise<void> | void) => Promise<void> | void;
export type Guard = (to: string, from: string, ctx: { app: any; meta?: any }) => boolean | string | Promise<boolean | string>;

export type RouteRecord = {
  path: string;
  component?: any | (() => Promise<any>);
  loader?: () => Promise<any>;
  layouts?: Array<() => Promise<any> | any>;
  meta?: Record<string, any>;
  middleware?: Middleware[];
  guards?: Guard[];
  notFound?: boolean;
};

export type Router = {
  _isRouter: true;
  _app?: any;
  current: string;
  routes: RouteRecord[];
  beforeEach(fn: Guard): void;
  use(mw: Middleware): void;
  start(host: HTMLElement): Promise<void>;
  push(to: string): Promise<void>;
  onNavigateStart?: (to: string, from: string) => void;
  onNavigateEnd?: (to: string, from: string) => void;
  onNavigateError?: (err: unknown, to: string, from: string) => void;
};

/* ----------------------------- Public API ------------------------------ */

export function defineRoutes(routes: RouteRecord[]): RouteRecord[] { return routes; }

export function createRouter(opts: {
  routes: RouteRecord[],
  history?: 'hash' | 'browser',
  hooks?: {
    start?: (to: string, from: string) => void,
    end?: (to: string, from: string) => void,
    error?: (err: unknown, to: string, from: string) => void
  }
}): Router {
  const router: Router & any = {
    _isRouter: true,
    _app: undefined,
    routes: opts.routes || [],
    current: normalizeUrl(location.pathname + location.hash.replace(/^#/, '')) || '/',
    _guards: [] as Guard[],
    _mws: [] as Middleware[],
    onNavigateStart: opts.hooks?.start,
    onNavigateEnd:   opts.hooks?.end,
    onNavigateError: opts.hooks?.error,

    beforeEach(fn: Guard) { this._guards.push(fn); },
    use(mw: Middleware)   { this._mws.push(mw); },

    async start(host: HTMLElement) {
      if (!this.routes.length) { host.setAttribute('data-marwa-router-view',''); return; }

      // Resolve current URL (may be 404); do NOT auto-redirect.
      await resolveRoute(this, host, this.current);

      // Client-side link handling
     document.addEventListener('click', (e) => {
        // only left-click without modifiers
        if ((e as MouseEvent).button !== 0 || (e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey || (e as MouseEvent).shiftKey || (e as MouseEvent).altKey) return;

        const a = (e.target as HTMLElement)?.closest('a[data-marwa-link]') as HTMLAnchorElement | null;
        if (!a) return;

        const to = a.getAttribute('data-to') || a.getAttribute('href') || '/';
        if (!to) return;

        // same-origin SPA nav: prevent default and push
        e.preventDefault();
        this.push(to);
      });

      // History navigation
      window.addEventListener('popstate', () => {
        this.current = normalizeUrl(location.pathname + location.hash.replace(/^#/, '')) || '/';
        resolveRoute(this, host, this.current).catch((err)=>this.onNavigateError?.(err,this.current,''));
      });
    },

    async push(to: string) {
      if (!this.routes.length) return;
      const url = normalizeUrl(to);
      if (url === this.current) return;

      const from = this.current;
      this.onNavigateStart?.(url, from);
      try {
        if (history && history.pushState) history.pushState({}, '', url);
        else location.hash = url;
        this.current = url;
        await resolveRoute(this, (this._app as any)._container, url);
        this.onNavigateEnd?.(url, from);
      } catch (err) {
        this.onNavigateError?.(err, url, from);
        throw err;
      }
    }
  };
  return router as Router;
}

/* ------------------------------ Core ----------------------------------- */

function normalizeUrl(u: string) {
  if (!u) return '/';
  try { if (/^https?:\/\//i.test(u)) return new URL(u).pathname || '/'; } catch {}
  if (!u.startsWith('/')) return u.startsWith('#/') ? u.slice(1) : ('/' + u.replace(/^#/, ''));
  return u;
}

async function resolveRoute(router: any, host: HTMLElement, to: string) {
  const from = router._last || '';
  router._last = to;

  const rec = match(router.routes, to);
  if (!rec) {
    const nf = findNotFound(router.routes);
    if (nf) { await renderRecord(router, host, nf, to, from); return; }
    host.innerHTML = `<div style="padding:1rem">Not Found: ${to}</div>`;
    return;
  }
  await renderRecord(router, host, rec, to, from);
}

async function renderRecord(router:any, host:HTMLElement, rec:RouteRecord, to:string, from:string) {
  let mod:any;
  if (rec.loader) mod = await rec.loader();
  else if (rec.component) {
    const loaded = typeof rec.component === 'function' && (rec.component as any).length === 0
      ? await (rec.component as any)()
      : rec.component;
    mod = loaded && loaded.default ? loaded : { default: loaded };
  } else mod = { default: null };

  const Cmp = mod.default ?? null;

  // definePage support
  const rawPage = mod.page;
  let page = rawPage;
  if (typeof rawPage === 'function') { try { page = await rawPage({ path: to }); } catch {} }
  const effMeta = page?.meta || (page?.title ? { title: page.title } : rec.meta);

  const effGuards: Guard[] = [...(router._guards||[]), ...(rec.guards||[]), ...(page?.guards||[])];
  const effMws: Middleware[] = [...(router._mws||[]), ...(rec.middleware||[]), ...(page?.middleware||[])];

  // guards
  for (const g of effGuards) {
    const res = await g(to, from, { app: router._app, meta: effMeta });
    if (res === false) return;
    if (typeof res === 'string') return router.push(res);
  }

  // middleware chain
  const params = extractParams(rec.path, to);
  let idx = -1;
  const ctx = { to, from, app: router._app, params };
  const next = async () => { idx++; if (idx < effMws.length) return await effMws[idx](ctx, next); };
  await next();

  if (effMeta?.title) document.title = effMeta.title;

  // mount layouts → page
  const mountTarget = ensureRouterView(host);
  mountTarget.innerHTML = '';
  let currentHost = mountTarget;

  for (const l of (rec.layouts || [])) {
    const lm = await (typeof l === 'function' ? l() : l);
    const L = lm?.default ?? lm;
    if (L) mountCmp(L, currentHost, {});
    currentHost = currentHost.querySelector('[data-marwa-router-view]') as HTMLElement || currentHost;
  }

  if (Cmp) mountCmp(Cmp, currentHost, { meta: effMeta, params, onNavigate: (p:string)=>router.push(p) });
}

/* ------------------------- Matching & Params --------------------------- */

function buildPathRegex(pattern: string): RegExp {
  if (pattern === '*') return /^.*$/; // catch-all
  // escape regex specials, then convert colon params back to named groups
  let esc = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&');
  esc = esc.replace(/\\:([A-Za-z_][\w-]*)/g, '(?<$1>[^/]+)');
  return new RegExp('^' + esc + '$');
}

function match(routes: RouteRecord[], url: string) {
  for (const r of routes) {
    if (r.notFound || r.path === '*') continue; // handle in fallback
    const rx = buildPathRegex(r.path);
    if (rx.test(url)) return r;
  }
  return null;
}

function findNotFound(routes: RouteRecord[]) {
  return routes.find(r => r.notFound) || routes.find(r => r.path === '*') || null;
}

function extractParams(pattern: string, url: string) {
  if (pattern === '*') return {};
  const rx = buildPathRegex(pattern);
  const m = url.match(rx);
  return (m && (m.groups || {})) || {};
}

/* --------------------------- DOM Helpers ------------------------------ */

function ensureRouterView(host: HTMLElement) {
  let view = host.querySelector('[data-marwa-router-view]') as HTMLElement | null;
  if (!view) { view = document.createElement('div'); view.setAttribute('data-marwa-router-view',''); host.appendChild(view); }
  return view;
}

/* ---------------- Built-in Components (for templates) ------------------ */
export const RouterLink = {
  __mount(el: HTMLElement, props: any) {
    // unwrap ref-like values
    const unwrap = (v: any) => (v && typeof v === 'object' && 'value' in v) ? v.value : v;

    const a = document.createElement('a');
    a.setAttribute('data-marwa-link', '');

    const rawTo = unwrap(props.to) ?? '#';
    const to = typeof rawTo === 'string' ? rawTo : String(rawTo);

    // set both href (for semantics) and data-to (for reliable SPA push)
    a.setAttribute('href', to);
    a.setAttribute('data-to', to);

    // text/children
    a.textContent = (props.children ?? props.text ?? el.textContent ?? '').toString();

    // replace original
    el.replaceWith(a);
  }
};

export const RouterView = {
  __mount(el: HTMLElement) { el.setAttribute('data-marwa-router-view',''); }
};