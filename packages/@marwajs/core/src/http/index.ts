// packages/@marwajs/core/src/http/index.ts
import { signal } from "../reactivity/signal";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RetryOptions {
  retries?: number; // total attempts including the first (default 1 = no retry)
  backoffMs?: number; // base backoff (linear)
  shouldRetry?: (res: Response | null, err: any) => boolean;
}

export interface TimeoutOptions {
  timeoutMs?: number; // abort after N ms
}

export interface RequestOptions extends TimeoutOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  // one of:
  json?: unknown; // serialize as JSON
  form?: Record<string, string | Blob | File>; // form-data
  body?: BodyInit | null; // raw body; wins over json/form if present
  credentials?: RequestCredentials;
  cache?: RequestCache;
  mode?: RequestMode;
  redirect?: RequestRedirect;
  integrity?: string;
  signal?: AbortSignal;
  retry?: RetryOptions;
}

export interface CreateHttpOptions extends TimeoutOptions {
  baseURL?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  retry?: RetryOptions;
  // Tiny interceptors
  onRequest?: (url: string, init: RequestInit) => void | Promise<void>;
  onResponse?: (res: Response) => void | Promise<void>;
  onError?: (err: any) => void | Promise<void>;
}

export interface HttpClient {
  request<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  get<T = unknown>(
    path: string,
    opts?: Omit<RequestOptions, "method" | "body" | "json" | "form">
  ): Promise<T>;
  post<T = unknown>(
    path: string,
    opts?: Omit<RequestOptions, "method">
  ): Promise<T>;
  put<T = unknown>(
    path: string,
    opts?: Omit<RequestOptions, "method">
  ): Promise<T>;
  patch<T = unknown>(
    path: string,
    opts?: Omit<RequestOptions, "method">
  ): Promise<T>;
  delete<T = unknown>(
    path: string,
    opts?: Omit<RequestOptions, "method">
  ): Promise<T>;
}

function buildURL(
  baseURL: string | undefined,
  path: string,
  query?: RequestOptions["query"]
) {
  const u = new URL(
    path,
    baseURL ||
      (typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost")
  );
  if (query) {
    for (const k of Object.keys(query)) {
      const v = query[k];
      if (v == null) continue;
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

function makeBodyAndHeaders(
  opts: RequestOptions,
  mergedHeaders: Record<string, string>
) {
  if (opts.body != null) {
    return { body: opts.body, headers: mergedHeaders };
  }
  if (opts.json !== undefined) {
    mergedHeaders["content-type"] =
      mergedHeaders["content-type"] || "application/json";
    return { body: JSON.stringify(opts.json), headers: mergedHeaders };
  }
  if (opts.form) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(opts.form)) {
      // @ts-ignore File/Blob is fine in DOM; in Node 18+ undici provides FormData
      fd.append(k, v as any);
    }
    // browser will set correct content-type boundary automatically
    return { body: fd as any, headers: mergedHeaders };
  }
  return { body: undefined, headers: mergedHeaders };
}

async function parseResponse<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    // graceful empty body handling
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : (undefined as any as T);
  }
  // return text for other content types
  return (await res.text()) as unknown as T;
}

export function createHttp(options: CreateHttpOptions = {}): HttpClient {
  const {
    baseURL,
    headers: baseHeaders = {},
    credentials,
    timeoutMs = options.timeoutMs,
    retry: baseRetry,
    onRequest,
    onResponse,
    onError,
  } = options;

  async function doRequest<T>(
    path: string,
    opts: RequestOptions = {}
  ): Promise<T> {
    const method = opts.method || "GET";
    const url = buildURL(baseURL, path, opts.query);

    const headers: Record<string, string> = {
      ...baseHeaders,
      ...(opts.headers || {}),
    };
    const { body, headers: finalHeaders } = makeBodyAndHeaders(opts, headers);

    let controller: AbortController | null = null;
    let signal = opts.signal;

    if (opts.timeoutMs || timeoutMs) {
      controller = new AbortController();
      signal = controller.signal;
      const ms = opts.timeoutMs ?? timeoutMs!;
      setTimeout(() => controller?.abort(), ms);
    }

    const init: RequestInit = {
      method,
      headers: finalHeaders,
      body,
      credentials: opts.credentials ?? credentials,
      cache: opts.cache,
      mode: opts.mode,
      redirect: opts.redirect,
      integrity: opts.integrity,
      signal,
    };

    const retry = {
      retries: opts.retry?.retries ?? baseRetry?.retries ?? 1,
      backoffMs: opts.retry?.backoffMs ?? baseRetry?.backoffMs ?? 0,
      shouldRetry:
        opts.retry?.shouldRetry ??
        baseRetry?.shouldRetry ??
        ((res: Response | null, err: any) =>
          !!err || (res ? res.status >= 500 : false)),
    };

    let attempt = 0;
    let lastErr: any = null;

    while (attempt < retry.retries!) {
      try {
        if (onRequest) await onRequest(url, init);
        const res = await fetch(url, init);
        if (onResponse) await onResponse(res);
        if (!res.ok) {
          // 4xx/5xx error
          if (attempt < retry.retries! - 1 && retry.shouldRetry(res, null)) {
            await delay(retry.backoffMs! * attempt);
            attempt++;
            continue;
          }
          const errPayload = await safeParseError(res);
          const e = new HttpError(res.status, res.statusText, errPayload);
          throw e;
        }
        return await parseResponse<T>(res);
      } catch (err) {
        lastErr = err;
        if (onError) await onError(err);
        if (attempt < retry.retries! - 1 && retry.shouldRetry(null, err)) {
          await delay(retry.backoffMs! * attempt);
          attempt++;
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  return {
    request: doRequest,
    get: (p, o) => doRequest(p, { ...(o || {}), method: "GET" }),
    post: (p, o) => doRequest(p, { ...(o || {}), method: "POST" }),
    put: (p, o) => doRequest(p, { ...(o || {}), method: "PUT" }),
    patch: (p, o) => doRequest(p, { ...(o || {}), method: "PATCH" }),
    delete: (p, o) => doRequest(p, { ...(o || {}), method: "DELETE" }),
  };
}

function delay(ms: number) {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

export class HttpError extends Error {
  status: number;
  info: any;
  constructor(status: number, message: string, info: any) {
    super(message);
    this.status = status;
    this.info = info;
  }
}

async function safeParseError(res: Response) {
  try {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const txt = await res.text();
      return txt ? JSON.parse(txt) : { status: res.status };
    }
    return await res.text();
  } catch {
    return { status: res.status, message: res.statusText };
  }
}

/** Reactive query helper */
export function createQuery<TArgs extends any[], TData>(
  fetcher: (...args: TArgs) => Promise<TData>
) {
  const data = signal<TData | undefined>(undefined as any);
  const error = signal<any>(null);
  const loading = signal(false);

  async function refetch(...args: TArgs) {
    loading.set(true);
    error.set(null);
    try {
      const d = await fetcher(...args);
      data.set(d as any);
      return d;
    } catch (e) {
      error.set(e);
      throw e;
    } finally {
      loading.set(false);
    }
  }

  return { data, error, loading, refetch };
}
