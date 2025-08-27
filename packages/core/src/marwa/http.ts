// src/http.ts
// Minimal HTTP client as a MarwaJS plugin (fits plugins.ts contracts)

import { definePlugin, type App, type MarwaPlugin } from './plugins';

export type Unsubscribe = () => void;

export type HttpRequest = {
  url: string;
  options: RequestInit;
};

export type HttpInterceptor = {
  /** Change request before it is sent. */
  request?(req: HttpRequest, app: App): Promise<HttpRequest> | HttpRequest;
  /** Inspect/transform response (throw here to route into `error`). */
  response?(res: Response, app: App): Promise<Response> | Response;
  /** Centralized error handler (can rethrow or return a Response). */
  error?(err: any, req: HttpRequest, app: App): Promise<Response> | Response;
};

export type HttpOptions = {
  /** Prefix added if url starts with `/` or no protocol. */
  baseURL?: string;
  /** Default headers merged into every request. */
  headers?: HeadersInit;
  /** Milliseconds; creates an AbortController per request. */
  timeout?: number;
};

export interface HttpClient {
  use(intc: HttpInterceptor): Unsubscribe;
  request(url: string, init?: RequestInit): Promise<Response>;

  get(url: string, init?: RequestInit): Promise<Response>;
  delete(url: string, init?: RequestInit): Promise<Response>;
  head(url: string, init?: RequestInit): Promise<Response>;
  options(url: string, init?: RequestInit): Promise<Response>;

  post(url: string, body?: any, init?: RequestInit): Promise<Response>;
  put(url: string, body?: any, init?: RequestInit): Promise<Response>;
  patch(url: string, body?: any, init?: RequestInit): Promise<Response>;

  /** Sugar: parse JSON safely with typed return. */
  getJSON<T = unknown>(url: string, init?: RequestInit): Promise<T>;
  postJSON<T = unknown>(url: string, body?: any, init?: RequestInit): Promise<T>;
  requestJSON<T = unknown>(url: string, init?: RequestInit): Promise<T>;
}

/* ---------------- Internals ---------------- */

function joinURL(base: string | undefined, url: string): string {
  if (!base) return url;
  const absolute = /^https?:\/\//i.test(url);
  if (absolute) return url;
  if (url.startsWith('/')) return base.replace(/\/+$/, '') + url;
  return base.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '');
}

function withTimeout(init: RequestInit | undefined, timeout?: number): RequestInit {
  if (!timeout) return init ?? {};
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const merged: RequestInit = { ...(init ?? {}), signal: controller.signal };
  // Ensure fetch clears the timer when it settles (in client.request we’ll wrap).
  (merged as any).__mwTimeoutId = id;
  (merged as any).__mwController = controller;
  return merged;
}

/* ---------------- Factory ---------------- */

export const HTTP_KEY = Symbol.for('marwa:http');

export function createHttp(options: HttpOptions = {}): MarwaPlugin {
  const interceptors = new Set<HttpInterceptor>();
  const defaults: HttpOptions = {
    baseURL: options.baseURL ?? '',
    headers: options.headers ?? {},
    timeout: options.timeout,
  };

  const client: HttpClient = {
    use(intc: HttpInterceptor): Unsubscribe {
      interceptors.add(intc);
      return () => interceptors.delete(intc);
    },

    async request(url: string, init: RequestInit = {}): Promise<Response> {
      // merge defaults
      const mergedHeaders: HeadersInit = {
        ...(defaults.headers || {}),
        ...(init.headers || {}),
      };
      const baseApplied = joinURL(defaults.baseURL, url);
      let req: HttpRequest = {
        url: baseApplied,
        options: withTimeout({ ...init, headers: mergedHeaders }, defaults.timeout),
      };

      // apply request interceptors in order
      for (const i of interceptors) {
        if (i.request) req = await i.request(req, (client as any).__app);
      }

      const clearTimer = () => {
        const id = (req.options as any).__mwTimeoutId as any;
        if (id) clearTimeout(id);
      };

      try {
        let res = await fetch(req.url, req.options);
        clearTimer();

        // apply response interceptors in order
        for (const i of interceptors) {
          if (i.response) res = await i.response(res, (client as any).__app);
        }
        return res;
      } catch (err) {
        clearTimer();
        // route through error interceptors (first that resolves wins)
        for (const i of interceptors) {
          if (i.error) {
            try {
              const maybe = await i.error(err, req, (client as any).__app);
              if (maybe instanceof Response) return maybe;
            } catch { /* allow next interceptor */ }
          }
        }
        throw err;
      }
    },

    get(url, init)     { return client.request(url, { ...(init||{}), method: 'GET' }); },
    delete(url, init)  { return client.request(url, { ...(init||{}), method: 'DELETE' }); },
    head(url, init)    { return client.request(url, { ...(init||{}), method: 'HEAD' }); },
    options(url, init) { return client.request(url, { ...(init||{}), method: 'OPTIONS' }); },

    post(url, body, init)  {
      const headers = { 'Content-Type': 'application/json', ...(init?.headers || {}) };
      return client.request(url, { ...(init||{}), method: 'POST', headers, body: body != null ? JSON.stringify(body) : undefined });
    },
    put(url, body, init)   {
      const headers = { 'Content-Type': 'application/json', ...(init?.headers || {}) };
      return client.request(url, { ...(init||{}), method: 'PUT', headers, body: body != null ? JSON.stringify(body) : undefined });
    },
    patch(url, body, init) {
      const headers = { 'Content-Type': 'application/json', ...(init?.headers || {}) };
      return client.request(url, { ...(init||{}), method: 'PATCH', headers, body: body != null ? JSON.stringify(body) : undefined });
    },

    async getJSON<T = unknown>(url, init) {
      const res = await client.get(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res.json() as Promise<T>;
    },
    async postJSON<T = unknown>(url, body, init) {
      const res = await client.post(url, body, init);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res.json() as Promise<T>;
    },
    async requestJSON<T = unknown>(url, init) {
      const res = await client.request(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res.json() as Promise<T>;
    },
  };

  // The actual plugin object
  return definePlugin({
    name: 'http',
    provides: {
      [HTTP_KEY]: client,
      // Optional string alias if you prefer: 'http': client
    },
    setup(app: App) {
      // expose app for interceptors needing DI (tokens, stores, etc.)
      (client as any).__app = app;
    }
  });
}

/* ---------------- Helpers ---------------- */

/** Sugar to inject the client with correct typing. */
export function useHttp(app: App): HttpClient {
  return app.inject(HTTP_KEY);
}
