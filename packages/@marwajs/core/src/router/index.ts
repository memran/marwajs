// packages/@marwajs/core/src/router/index.ts
import { ref, type Ref } from "../reactivity/ref";
import { effect, stop } from "../reactivity/effect";
import * as Dom from "../runtime/dom";
import { defineComponent, type ComponentHooks } from "../runtime/component";
import type { App } from "../runtime/app";

// ===== Types =====
export type ComponentFactory = ReturnType<typeof defineComponent>;
export type ComponentLoader = () =>
  | ComponentFactory
  | Promise<ComponentFactory>;

export type RouteRecord = {
  path: string; // '/', '/users/:id', '*'
  component?: ComponentFactory | ComponentLoader;
};

export type RouteMatch = {
  record: RouteRecord | null;
  params: Record<string, string>;
  path: string;
};

export type RouterOptions = {
  mode?: "hash" | "history";
  base?: string; // for history mode, default '/'
  routes: RouteRecord[];
};

type CompiledRecord = {
  record: RouteRecord;
  re: RegExp;
  keys: string[];
};

export type Router = {
  mode: "hash" | "history";
  base: string;
  current: Ref<RouteMatch>;
  push(path: string): void;
  replace(path: string): void;
  back(): void;
};

/** Ergonomic helper for route arrays */
export function defineRoutes<T extends RouteRecord[]>(routes: T): T {
  return routes;
}

export function createRouter(opts: RouterOptions): Router {
  const mode = opts.mode ?? "hash";
  const base = normalizeBase(opts.base ?? "/");
  const compiled: CompiledRecord[] = opts.routes.map((r) => compile(r));

  // tiny internal history (used mainly for hash mode determinism in tests)
  let stack: string[] = [];
  let idx = -1;

  function match(path: string): RouteMatch {
    for (const c of compiled) {
      const m = c.re.exec(path);
      if (m) {
        const params: Record<string, string> = {};
        for (let i = 0; i < c.keys.length; i++)
          params[c.keys[i]] = decodeURIComponent(m[i + 1] ?? "");
        return { record: c.record, params, path };
      }
    }
    const star = compiled.find((c) => c.record.path === "*")?.record ?? null;
    return { record: star, params: {}, path };
  }

  function getPathFromLocation(): string {
    if (mode === "hash") {
      const h = window.location.hash;
      const p = h && h.startsWith("#") ? h.slice(1) : "/";
      return ensureLeadingSlash(p || "/");
    } else {
      let p = window.location.pathname || "/";
      if (base !== "/" && p.startsWith(base)) {
        p = p.slice(base.length) || "/";
      }
      return ensureLeadingSlash(p || "/");
    }
  }

  function pushToInternal(path: string, replace = false) {
    if (replace && idx >= 0) stack[idx] = path;
    else {
      stack = stack.slice(0, idx + 1);
      stack.push(path);
      idx++;
    }
  }
  function syncIndexTo(path: string) {
    const i = stack.lastIndexOf(path);
    if (i >= 0) idx = i;
    else {
      stack.push(path);
      idx = stack.length - 1;
    }
  }

  const current = ref<RouteMatch>({ record: null, params: {}, path: "" });

  // --- INIT (normalize URL first) ---
  if (mode === "hash") {
    if (!window.location.hash) window.location.hash = "#/";
  } else {
    // Force absolute URL; if jsdom ignores replaceState, fall back to href
    const wantInit = base === "/" ? "/" : base + "/";
    ensurePathname(wantInit);
  }

  // Now compute initial logical path from normalized URL
  const initialPath = getPathFromLocation();
  current.value = match(initialPath);
  stack = [initialPath];
  idx = 0;

  // listen
  const onPop = () => {
    const path = getPathFromLocation();
    syncIndexTo(path);
    current.value = match(path);
  };
  window.addEventListener(mode === "hash" ? "hashchange" : "popstate", onPop);

  function push(path: string) {
    path = ensureLeadingSlash(path);
    if (mode === "hash") {
      pushToInternal(path, false);
      window.location.hash = "#" + path;
      current.value = match(path);
    } else {
      const full =
        base === "/" ? path : path === "/" ? base + "/" : base + path;
      historyPushAbs(full);
      if (window.location.pathname !== full) {
        (window as any).location.href = abs(full);
      }
      current.value = match(path);
    }
  }

  function replace(path: string) {
    path = ensureLeadingSlash(path);
    if (mode === "hash") {
      pushToInternal(path, true);
      window.location.replace("#" + path);
      current.value = match(path);
    } else {
      // Root → trailing slash to match tests ("/app/")
      const full =
        base === "/" ? path : path === "/" ? base + "/" : base + path;
      historyReplaceAbs(full);
      if (window.location.pathname !== full) {
        (window as any).location.href = abs(full);
      }
      current.value = match(path);
    }
  }

  function back() {
    if (mode === "hash") {
      if (idx > 0) {
        idx--;
        const path = stack[idx];
        window.location.hash = "#" + path;
        current.value = match(path);
      }
    } else {
      window.history.back();
    }
  }

  return { mode, base, current, push, replace, back };
}

/** Component that renders the matched route's component. */
export function RouterView(router: Router) {
  return defineComponent((_props, ctxArg?: { app?: App }) => {
    const container = Dom.createElement("div");
    let child: ComponentHooks | null = null;

    function clear() {
      if (child) {
        try {
          child.destroy?.();
        } catch {}
        child = null;
      }
      while (container.firstChild) container.removeChild(container.firstChild);
    }

    function mountComp(factory: ComponentFactory) {
      const app = ctxArg?.app as App | undefined;
      const inst = factory({}, { app: app as any });
      child = inst;
      inst.mount(container);
    }

    function isPromise<T>(v: any): v is Promise<T> {
      return v && typeof v.then === "function";
    }

    function resolveFactory(
      c: RouteRecord["component"]
    ): ComponentFactory | Promise<ComponentFactory> | null {
      if (!c) return null;
      if (typeof c === "function") {
        // defineComponent factory has arity 2 (props, ctx), loader has arity 0
        if ((c as Function).length === 0) {
          return (c as ComponentLoader)();
        }
        return c as ComponentFactory;
      }
      return null;
    }

    function render() {
      clear();
      const rec = router.current.value.record;
      if (!rec || !rec.component) return;

      const maybe = resolveFactory(rec.component);
      if (!maybe) return;

      if (isPromise<ComponentFactory>(maybe)) {
        maybe.then(mountComp);
      } else {
        mountComp(maybe);
      }
    }

    const rerun = effect(() => {
      void router.current.value.path; // track dependency
      render();
    });

    return {
      mount(target, anchor) {
        Dom.insert(container, target as Element, anchor ?? null);
        render();
      },
      destroy() {
        stop(rerun);
        clear();
        Dom.remove(container);
      },
    };
  });
}

/** Simple link helper; compiler can unwrap <RouterLink to="..."> to <a> + click handler */
export function RouterLink(
  router: Router,
  to: string,
  attrs?: Record<string, string>
) {
  const a = Dom.createElement("a");
  a.setAttribute(
    "href",
    router.mode === "hash"
      ? "#" + ensureLeadingSlash(to)
      : ensureLeadingSlash(to)
  );
  if (attrs) for (const k in attrs) a.setAttribute(k, attrs[k]);
  a.addEventListener("click", (e) => {
    e.preventDefault();
    router.push(to);
  });
  return a;
}

/** Composition helper */
export function useRoute(router: Router): Ref<RouteMatch> {
  return router.current;
}

// ===== utils =====
function compile(record: RouteRecord): CompiledRecord {
  if (record.path === "*") {
    return { record, re: /^.*$/, keys: [] };
  }
  const { re, keys } = pathToRegex(record.path);
  return { record, re, keys };
}

function pathToRegex(path: string): { re: RegExp; keys: string[] } {
  const keys: string[] = [];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reStr = path
    .split("/")
    .map((seg) => {
      if (!seg) return "";
      if (seg.startsWith(":")) {
        keys.push(seg.slice(1));
        return "([^/]+)";
      }
      return esc(seg);
    })
    .join("\\/");
  const full = "^/" + reStr.replace(/^\\\//, "") + "$";
  return { re: new RegExp(full), keys };
}

function ensureLeadingSlash(p: string): string {
  if (typeof p !== "string") p = "/";
  return p.startsWith("/") ? p : "/" + p;
}

function normalizeBase(b: string) {
  if (!b.startsWith("/")) b = "/" + b;
  if (b.length > 1 && b.endsWith("/")) b = b.slice(0, -1);
  return b;
}
// ---- helpers (place near bottom) ----
function abs(path: string) {
  const origin =
    (window.location && window.location.origin) || "http://localhost";
  return origin + path;
}

function historyReplaceAbs(path: string) {
  window.history.replaceState({}, "", abs(path));
}

function historyPushAbs(path: string) {
  window.history.pushState({}, "", abs(path));
}

function ensurePathname(path: string) {
  const want = path;
  if (window.location.pathname !== want) {
    try {
      historyReplaceAbs(want);
    } catch {}
    // jsdom sometimes ignores replaceState; hard fallback:
    if (window.location.pathname !== want) {
      (window as any).location.href = abs(want);
    }
  }
}
