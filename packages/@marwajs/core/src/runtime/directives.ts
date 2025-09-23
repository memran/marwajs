import { effect, stop } from "../reactivity/effect";
import type { App } from "./app";
import * as Dom from "./dom";

/** :text */
export function bindText(target: Node, compute: () => any): () => void {
  Dom.setText(target, toStringSafe(compute())); // eager first write
  const runner = effect(() => {
    Dom.setText(target, toStringSafe(compute()));
  });
  return () => stop(runner);
}
/** :attr (generic attribute binding, e.g. :id, :src, :aria-label) */

export function bindAttr(
  el: HTMLElement,
  name: string,
  compute: () => unknown
): () => void {
  // eager first write for deterministic content
  Dom.setAttr(el, name, compute() as any);
  const runner = effect(() => {
    Dom.setAttr(el, name, compute() as any);
  });
  return () => stop(runner);
}

/** :html */
export function bindHTML(
  el: HTMLElement,
  compute: () => string,
  sanitize?: (html: string) => string
): () => void {
  const runner = effect(() => {
    const raw = compute() ?? "";
    el.innerHTML = sanitize ? sanitize(String(raw)) : String(raw);
  });
  return () => stop(runner);
}

/** :show */
export function bindShow(el: HTMLElement, compute: () => boolean): () => void {
  const runner = effect(() => {
    Dom.show(el, !!compute());
  });
  return () => stop(runner);
}

/** :class */
export function bindClass(
  el: HTMLElement,
  compute: () => string | Record<string, boolean>
): () => void {
  const runner = effect(() => {
    Dom.setClass(el, compute() as any);
  });
  return () => stop(runner);
}

/** :style */
export function bindStyle(
  el: HTMLElement,
  compute: () => Record<string, string | null | undefined>
): () => void {
  const runner = effect(() => {
    Dom.setStyle(el, compute() || {});
  });
  return () => stop(runner);
}

/** Event wiring via App-level delegation */
export function on(
  app: App,
  el: HTMLElement,
  type: string,
  handler: (e: Event) => void
): () => void {
  if (!("isConnected" in app.container) || !app.container.isConnected) {
    el.addEventListener(type, handler);
    return () => el.removeEventListener(type, handler);
  }
  return app.on(type, el, handler);
}

/** Event modifiers helper (compiler wraps handlers with this) */
export function withModifiers(
  handler: (e: Event) => any,
  mods: Array<"stop" | "prevent" | "self" | "once" | "capture" | "passive">
) {
  let fired = false; // for "once"
  return function (e: Event) {
    if (mods.includes("self") && e.target !== e.currentTarget) return;
    if (mods.includes("once")) {
      if (fired) return;
      fired = true;
    }
    if (mods.includes("capture")) {
      // Delegation runs in bubble phase; capture is a no-op here (documented).
      // Compiler can choose native capture by adding a root listener if needed.
    }
    if (mods.includes("passive")) {
      // Not applicable in delegated model; document as no-op.
    }
    if (mods.includes("prevent")) e.preventDefault();
    if (mods.includes("stop")) e.stopPropagation();
    return handler(e);
  };
}

/** m-model (two-way) */
export interface ModelOptions {
  lazy?: boolean;
  trim?: boolean;
  number?: boolean;
  type?: "text" | "checkbox" | "radio" | "select";
  debounce?: number; // ← ms; only used for text/textarea on "input" events
}

export function bindModel(
  app: App,
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  get: () => any,
  set: (v: any) => void,
  opts: ModelOptions = {}
): () => void {
  const type =
    opts.type ||
    (el instanceof HTMLInputElement
      ? (el.type as ModelOptions["type"])
      : (el.tagName.toLowerCase() as ModelOptions["type"]));

  // 1) view <- model
  const stopView = effect(() => {
    const v = get();
    if (type === "checkbox") {
      (el as HTMLInputElement).checked = !!v;
    } else if (type === "radio") {
      (el as HTMLInputElement).checked =
        String(v) === (el as HTMLInputElement).value;
    } else if (type === "select") {
      (el as HTMLSelectElement).value = v == null ? "" : String(v);
    } else {
      (el as HTMLInputElement | HTMLTextAreaElement).value =
        v == null ? "" : String(v);
    }
  });

  // 2) model <- view
  const isFormChange =
    type === "checkbox" || type === "radio" || type === "select";
  //const isInputLike = !isFormChange && type !== "select";
  const isInputLike = !isFormChange;

  const evt = isFormChange ? "change" : opts.lazy ? "change" : "input";

  // Debounced setter (only for input/textarea on "input" events)
  let timer: any = null;
  const useDebounce =
    isInputLike &&
    evt === "input" &&
    typeof opts.debounce === "number" &&
    opts.debounce > 0;
  const applySet = (v: any) => {
    if (!useDebounce) {
      set(v);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => set(v), opts.debounce);
  };

  const off = on(app, el as HTMLElement, evt, () => {
    let v: any;
    if (type === "checkbox") {
      v = (el as HTMLInputElement).checked;
    } else if (type === "radio") {
      if ((el as HTMLInputElement).checked) v = (el as HTMLInputElement).value;
      else return;
    } else if (type === "select") {
      v = (el as HTMLSelectElement).value;
    } else {
      v = (el as HTMLInputElement | HTMLTextAreaElement).value;
      if (opts.trim && typeof v === "string") v = v.trim();
      if (opts.number) {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) v = n;
      }
    }
    applySet(v);
  });

  return () => {
    off();
    stop(stopView);
    if (timer) {
      clearTimeout(timer); // clean pending debounce
      timer = null;
    }
  };
}

function toStringSafe(v: any): string {
  if (v == null) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}
