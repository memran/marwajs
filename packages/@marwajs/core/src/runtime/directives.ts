import { effect, stop } from "../reactivity/effect";
import type { App } from "./app";
import * as Dom from "./dom";

/* =========================
   Internal helpers (DRY)
   ========================= */

function asNode(el: any): Node | null {
  // Accept real nodes or element-like objects (for jsdom)
  if (!el) return null;
  if (typeof el === "object") {
    if ("nodeType" in el || "isConnected" in el) return el as Node;
    if (typeof (el as any).addEventListener === "function") return el as Node;
  }
  return null;
}

/** Wrap a reactive effect with try/catch + stable disposer. */
function makeEffect<T>(
  name: string,
  run: () => void,
  onError?: (err: unknown) => void
): () => void {
  let runner: any;
  try {
    runner = effect(() => {
      try {
        run();
      } catch (e) {
        // Surface runtime error with directive name for quick pinpointing
        console.error(`[${name}] runtime error in effect:`, e);
        onError?.(e);
      }
    });
  } catch (e) {
    console.error(`[${name}] failed to start effect:`, e);
    return () => {};
  }
  return () => {
    try {
      stop(runner);
    } catch (e) {
      console.error(`[${name}] failed to stop effect:`, e);
    }
  };
}

/** Safely run a one-off update with error surfacing. */
function runOnce(name: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.error(`[${name}] initial run error:`, e);
  }
}

/** Whether we can use delegated events via App. */
function canDelegate(app: App | any): boolean {
  return !!(
    app &&
    typeof app.on === "function" &&
    app.container &&
    typeof app.container.isConnected === "boolean" &&
    app.container.isConnected
  );
}

/* =========================
   Public API (unchanged)
   ========================= */

/** :text */
export function bindText(target: Node, compute: () => any): () => void {
  const el = asNode(target);
  if (!el) return () => {};
  runOnce("bindText", () => Dom.setText(el, toStringSafe(compute())));
  return makeEffect("bindText", () => {
    Dom.setText(el, toStringSafe(compute()));
  });
}

/** :attr (generic attribute binding, e.g. :id, :src, :aria-label) */
export function bindAttr(
  el: HTMLElement,
  name: string,
  compute: () => unknown
): () => void {
  const n = asNode(el) as HTMLElement | null;
  if (!n) return () => {};
  runOnce("bindAttr", () => Dom.setAttr(n, name, compute() as any));
  return makeEffect("bindAttr", () => {
    Dom.setAttr(n, name, compute() as any);
  });
}

/** :html */
export function bindHTML(
  el: HTMLElement,
  compute: () => string,
  sanitize?: (html: string) => string
): () => void {
  const n = asNode(el) as HTMLElement | null;
  if (!n) return () => {};
  return makeEffect("bindHTML", () => {
    const raw = compute() ?? "";
    n.innerHTML = sanitize ? sanitize(String(raw)) : String(raw);
  });
}

/** :show */
export function bindShow(el: HTMLElement, compute: () => boolean): () => void {
  const n = asNode(el) as HTMLElement | null;
  if (!n) return () => {};
  return makeEffect("bindShow", () => {
    Dom.show(n, !!compute());
  });
}

/** :class */
export function bindClass(
  el: HTMLElement,
  compute: () => string | Record<string, boolean>
): () => void {
  const n = asNode(el) as HTMLElement | null;
  if (!n) return () => {};
  return makeEffect("bindClass", () => {
    Dom.setClass(n, compute() as any);
  });
}

/** :style */
export function bindStyle(
  el: HTMLElement,
  compute: () => Record<string, string | null | undefined>
): () => void {
  const n = asNode(el) as HTMLElement | null;
  if (!n) return () => {};
  return makeEffect("bindStyle", () => {
    Dom.setStyle(n, compute() || {});
  });
}

/** Event wiring via App-level delegation (fallback to direct listener) */
export function on(
  app: App | any,
  el: HTMLElement,
  type: string,
  handler: (e: Event) => void
): () => void {
  const n = asNode(el) as HTMLElement | null;
  if (!n) return () => {};

  try {
    if (canDelegate(app)) {
      // Delegate via app (bubbling)
      return app.on(type, n, handler);
    }
  } catch (e) {
    console.error(`[on] app.on failed, falling back to direct listener:`, e);
    // fall through to direct listener
  }

  try {
    n.addEventListener(type, handler);
    return () => n.removeEventListener(type, handler);
  } catch (e) {
    console.error(`[on] addEventListener failed:`, e);
    return () => {};
  }
}

/** Event modifiers helper (compiler wraps handlers with this) */
export function withModifiers(
  handler: (e: Event) => any,
  mods: Array<"stop" | "prevent" | "self" | "once" | "capture" | "passive">
) {
  let fired = false; // for "once"
  return function (e: Event) {
    try {
      if (mods.includes("self") && e.target !== e.currentTarget) return;
      if (mods.includes("once")) {
        if (fired) return;
        fired = true;
      }
      // "capture" and "passive" are documented as no-ops in delegated model
      if (mods.includes("prevent")) e.preventDefault();
      if (mods.includes("stop")) e.stopPropagation();
      return handler(e);
    } catch (err) {
      console.error(`[withModifiers] handler error:`, err);
    }
  };
}

/** m-model (two-way) */
export interface ModelOptions {
  lazy?: boolean;
  trim?: boolean;
  number?: boolean;
  type?: "text" | "checkbox" | "radio" | "select";
  debounce?: number; // ms (only for input/textarea on "input")
}

export function bindModel(
  app: App,
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  get: () => any,
  set: (v: any) => void,
  opts: ModelOptions = {}
): () => void {
  const n = asNode(el) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | null;
  if (!n) return () => {};

  const type =
    opts.type ||
    (n instanceof HTMLInputElement
      ? (n.type as ModelOptions["type"])
      : (n.tagName.toLowerCase() as ModelOptions["type"]));

  // 1) view <- model
  const stopView = makeEffect("bindModel(view<-model)", () => {
    const v = get();
    if (type === "checkbox") {
      (n as HTMLInputElement).checked = !!v;
    } else if (type === "radio") {
      (n as HTMLInputElement).checked =
        String(v) === (n as HTMLInputElement).value;
    } else if (type === "select") {
      (n as HTMLSelectElement).value = v == null ? "" : String(v);
    } else {
      (n as HTMLInputElement | HTMLTextAreaElement).value =
        v == null ? "" : String(v);
    }
  });

  // 2) model <- view
  const isFormChange =
    type === "checkbox" || type === "radio" || type === "select";
  const isInputLike = !isFormChange;
  const evt = isFormChange ? "change" : opts.lazy ? "change" : "input";

  let timer: any = null;
  const useDebounce =
    isInputLike &&
    evt === "input" &&
    typeof opts.debounce === "number" &&
    opts.debounce > 0;

  const applySet = (v: any) => {
    if (!useDebounce) {
      try {
        set(v);
      } catch (e) {
        console.error(`[bindModel(model<-view)] setter error:`, e);
      }
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        set(v);
      } catch (e) {
        console.error(`[bindModel(model<-view)] debounced setter error:`, e);
      }
    }, opts.debounce);
  };

  const off = on(app as any, n as HTMLElement, evt, () => {
    try {
      let v: any;
      if (type === "checkbox") {
        v = (n as HTMLInputElement).checked;
      } else if (type === "radio") {
        if ((n as HTMLInputElement).checked) v = (n as HTMLInputElement).value;
        else return;
      } else if (type === "select") {
        v = (n as HTMLSelectElement).value;
      } else {
        v = (n as HTMLInputElement | HTMLTextAreaElement).value;
        if (opts.trim && typeof v === "string") v = v.trim();
        if (opts.number) {
          const num = parseFloat(v);
          if (!Number.isNaN(num)) v = num;
        }
      }
      applySet(v);
    } catch (e) {
      console.error(`[bindModel] event handler error:`, e);
    }
  });

  return () => {
    try {
      off();
    } catch (e) {
      console.error(`[bindModel] off() error:`, e);
    }
    try {
      stopView();
    } catch (e) {
      console.error(`[bindModel] stopView() error:`, e);
    }
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

function toStringSafe(v: any): string {
  if (v == null) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}
