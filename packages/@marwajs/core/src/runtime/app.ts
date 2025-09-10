// App container with event delegation per type.
// Each `createApp(container)` keeps a map: type -> WeakMap(el -> handler)

export interface App {
  container: HTMLElement;
  on(type: string, el: HTMLElement, handler: (e: Event) => void): () => void;
}

type HandlerMap = WeakMap<HTMLElement, (e: Event) => void>;

export function createApp(container: HTMLElement): App {
  const delegates = new Map<string, HandlerMap>();

  function ensureRootListener(type: string) {
    if (delegates.has(type)) return;
    const map: HandlerMap = new WeakMap();
    delegates.set(type, map);

    container.addEventListener(type, (e) => {
      // Walk up from target until container, call first matching handler.
      let n = e.target as Node | null;
      while (n && n !== container) {
        if (n instanceof HTMLElement) {
          const h = map.get(n);
          if (h) {
            h(e);
            break;
          }
        }
        n = n.parentNode;
      }
    });
  }

  function on(
    type: string,
    el: HTMLElement,
    handler: (e: Event) => void
  ): () => void {
    ensureRootListener(type);
    const map = delegates.get(type)!;
    map.set(el, handler);
    return () => map.delete(el);
  }

  return { container, on };
}
