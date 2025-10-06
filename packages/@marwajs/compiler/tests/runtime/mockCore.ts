// tests/runtime/mockCore.ts
// Minimal mock of @marwajs/core for tests running under happy-dom
export type StopFn = () => void;

export const Dom = {
  createElement(tag: string): HTMLElement {
    return document.createElement(tag);
  },
  createText(text: string): Text {
    return document.createTextNode(text);
  },
  insert(node: Node, parent: Node, anchor?: Node | null): void {
    if (anchor) parent.insertBefore(node, anchor);
    else parent.appendChild(node);
  },
  setAttr(el: Element, name: string, value: string): void {
    el.setAttribute(name, value);
  },
  remove(node: Node): void {
    node.parentNode?.removeChild(node);
  },
  createAnchor(label = "a"): Comment {
    return document.createComment(label);
  },
};

export function bindText(target: Text, get: () => any): StopFn {
  let disposed = false;
  const update = () => {
    if (disposed) return;
    target.textContent = String(get() ?? "");
  };
  update();
  const id = setInterval(update, 1); // ultra-fast polling for tests
  return () => {
    disposed = true;
    clearInterval(id);
  };
}

export function bindClass(el: HTMLElement, get: () => any): StopFn {
  let disposed = false;
  const update = () => {
    if (disposed) return;
    const v = String(get() ?? "");
    el.className = v;
  };
  update();
  const id = setInterval(update, 1);
  return () => {
    disposed = true;
    clearInterval(id);
  };
}

export function bindStyle(el: HTMLElement, get: () => any): StopFn {
  let disposed = false;
  const update = () => {
    if (disposed) return;
    const obj = get() || {};
    if (typeof obj === "string") {
      el.setAttribute("style", obj);
      return;
    }
    el.removeAttribute("style");
    for (const k of Object.keys(obj)) (el.style as any)[k] = obj[k];
  };
  update();
  const id = setInterval(update, 1);
  return () => {
    disposed = true;
    clearInterval(id);
  };
}

export function bindShow(el: HTMLElement, get: () => any): StopFn {
  let disposed = false;
  const update = () => {
    if (disposed) return;
    const on = !!get();
    el.style.display = on ? "" : "none";
  };
  update();
  const id = setInterval(update, 1);
  return () => {
    disposed = true;
    clearInterval(id);
  };
}

export function bindAttr(
  el: HTMLElement,
  name: string,
  get: () => any
): StopFn {
  let disposed = false;
  const update = () => {
    if (disposed) return;
    const v = get();
    if (v == null || v === false) el.removeAttribute(name);
    else el.setAttribute(name, String(v === true ? "" : v));
  };
  update();
  const id = setInterval(update, 1);
  return () => {
    disposed = true;
    clearInterval(id);
  };
}

export function onEvent(
  _app: any,
  el: Element,
  type: string,
  handler: (e: Event) => any
): StopFn {
  el.addEventListener(type, handler);
  return () => el.removeEventListener(type, handler);
}

export const coreRuntime = {
  Dom,
  bindText,
  bindClass,
  bindStyle,
  bindShow,
  bindAttr,
  onEvent,
};
