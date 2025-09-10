import { ref, type Ref } from "../reactivity/ref";
import { effect, stop } from "../reactivity/effect";

import * as Dom from "../runtime/dom";
import { defineComponent, type ComponentHooks } from "../runtime/component";
import type { App } from "../runtime/app";

export type RouteRecord = {
  path: string; // e.g. '/', '/users/:id', '*'
  component?: () =>
    | Promise<ReturnType<ReturnType<typeof defineComponent>>>
    | ReturnType<ReturnType<typeof defineComponent>>;
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

/** Public helper to keep route types ergonomic in user-land */
export function defineRoutes<T extends RouteRecord[]>(routes: T): T {
  return routes;
}

export function createRouter(opts: RouterOptions): Router {
  const mode = opts.mode ?? "hash";
  const base = normalizeBase(opts.base ?? "/");

  const compiled: CompiledRecord[] = opts.routes.map((r) => compile(r));

  // --- tiny internal history for hash mode (helps test envs & consistency) ---
  let stack: string[] = [];
  let idx = -1;
  // ---------------------------------------------------------------------------

  function match(path: string): RouteMatch {
    for (const c of compiled) {
      const m = c.re.exec(path);
      if (m) {
        const params: Record<string, string> = {};
        for (let i = 0; i < c.keys.length; i++) {
          params[c.keys[i]] = decodeURIComponent(m[i + 1] ?? "");
        }
        return { record: c.record, params, path };
      }
    }
    // explicit fallback to '*' (if defined), otherwise null record
    const starRec = compiled.find((c) => c.record.path === "*")?.record ?? null;
    return { record: starRec, params: {}, path };
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
    if (replace && idx >= 0) {
      stack[idx] = path;
    } else {
      // truncate forward history and push
      stack = stack.slice(0, idx + 1);
      stack.push(path);
      idx++;
    }
  }

  function syncIndexTo(path: string) {
    const i = stack.lastIndexOf(path);
    if (i >= 0) idx = i;
    else {
      // new path not in stack (e.g., user typed URL) -> append
      stack.push(path);
      idx = stack.length - 1;
    }
  }

  const current = ref<RouteMatch>({ record: null, params: {}, path: "" });

  // init
  if (mode === "hash") {
    if (!window.location.hash) {
      window.location.hash = "#/";
    }
  }
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
      // proactively update reactive state (hashchange is async)
      current.value = match(path);
    } else {
      const full = base === "/" ? path : base + (path === "/" ? "" : path);
      window.history.pushState({}, "", full);
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
      const full = base === "/" ? path : base + (path === "/" ? "" : path);
      window.history.replaceState({}, "", full);
      current.value = match(path);
    }
  }

  function back() {
    if (mode === "hash") {
      if (idx > 0) {
        idx--;
        const path = stack[idx];
        // update hash and reactive state immediately
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
  return defineComponent((_props, ctx) => {
    const container = Dom.createElement("div");
    let child: ComponentHooks | null = null;

    function clear() {
      if (child) {
        child.destroy?.();
        child = null;
      }
      while (container.firstChild) container.removeChild(container.firstChild);
    }

    function mountComp(factory: any) {
      const inst = (factory as any)({}, { app: ctx.app as App });
      child = inst;
      inst.mount(container);
    }

    function render() {
      clear();
      const rec = router.current.value.record;
      if (!rec || !rec.component) return;
      const res = rec.component();
      if (res && typeof (res as any).then === "function") {
        (res as Promise<any>).then(mountComp);
      } else {
        mountComp(res);
      }
    }

    // reactive re-render on route change
    const rerun = effect(() => {
      const p = router.current.value.path; // track dependency
      // (no-op to silence unused var in some TS configs)
      if (p || p === "") {
      }
      render();
    });

    return {
      mount(target, anchor) {
        Dom.insert(container, target, anchor ?? null);
        render();
      },
      destroy() {
        stop(rerun); // <-- properly stop the effect
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
    // SPA navigate
    e.preventDefault();
    router.push(to);
  });
  return a;
}

/** Composition helper */
export function useRoute(router: Router): Ref<RouteMatch> {
  return router.current;
}

// utils
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

function ensureLeadingSlash(p: string) {
  return p.startsWith("/") ? p : "/" + p;
}
function normalizeBase(b: string) {
  if (!b.startsWith("/")) b = "/" + b;
  if (b.length > 1 && b.endsWith("/")) b = b.slice(0, -1);
  return b;
}
