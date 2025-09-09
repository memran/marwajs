import { setCurrentCtx } from './instance';

const injectedScopes = new Set<string>();

function injectStyles(scopeId?: string, css?: string) {
  if (!css || !scopeId) return;
  if (injectedScopes.has(scopeId)) return;
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-marwa-scope', scopeId);
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
  injectedScopes.add(scopeId);
}

export type Emit = (evt: string, payload?: any) => void;

export type ComponentOptions = {
  name?: string;
  styles?: string;
  scopeId?: string;
  setup: (props: Record<string, any>, emit: Emit) => any;
  render: (root: HTMLElement, ctx: any) => () => void | void;
};

/** lifecycle helpers (invoked by compiler-generated glue) */
export function runMount(ctx: any) {
  try {
    const list: Array<() => void> | undefined = ctx && ctx.__m;
    if (Array.isArray(list)) for (const fn of list) try { fn && fn(); } catch {}
  } catch {}
}
export function runCleanup(ctx: any) {
  try {
    const list: Array<() => void> | undefined = ctx && ctx.__c;
    if (Array.isArray(list)) {
      for (const fn of list) try { fn && fn(); } catch {}
      list.length = 0;
    }
  } catch {}
}

/**
 * Define a Marwa component. Returned object exposes __mount(target, props, parentEmit?)
 */
export function defineComponent(opts: ComponentOptions) {
  return {
    ...opts,
    __mount(target: HTMLElement, props: Record<string, any> = {}, parentEmit: Emit = () => {}) {
      // 1) ensure scoped CSS is present
      injectStyles(opts.scopeId, opts.styles);

      // 2) create a provisional ctx so helpers (e.g., useModel) work inside setup()
      const emitProxy: Emit = createEmitProxy(props, parentEmit);
      const provisional = { props, emit: emitProxy, __m: [], __c: [] };
      setCurrentCtx(provisional);

      // 3) run setup and swap ctx to the final object
      const ctx = opts.setup(props, emitProxy) ?? provisional;
      setCurrentCtx(ctx);

      // 4) mount + render
      runMount(ctx);
      const cleanup = opts.render(target, ctx);

      // 5) unmount
      return () => {
        try { if (typeof cleanup === 'function') cleanup(); }
        finally { runCleanup(ctx); setCurrentCtx(null); }
      };
    }
  };
}

/**
 * Mount a component instance. Accepts default export or object with __mount.
 */
export function mount(Cmp: any, el: HTMLElement, props: Record<string, any> = {}) {
  const comp =
    (Cmp && typeof Cmp.__mount === 'function') ? Cmp :
    (Cmp?.default && typeof Cmp.default.__mount === 'function') ? Cmp.default :
    null;

  if (!comp) throw new Error('Marwa: component missing __mount');

  // default parent emit: try props handlers first, then bubble to current ctx
  const parentEmit: Emit = (evt, payload) => {
    const handler = findPropsHandler(props, evt);
    if (handler) return handler(payload);
    const g: any = (globalThis as any).__marwaCurrentCtx;
    if (g && typeof g[evt] === 'function') return g[evt](payload);
  };

  return comp.__mount(el, props, parentEmit);
}

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

/**
 * emit() routes child events to parent-supplied handlers via props.
 * - update:x   -> props['onUpdate:x'](payload)
 * - customEvt  -> props['on' + PascalCase(evt)](payload)
 */
function createEmitProxy(props: Record<string, any>, parentEmit: Emit): Emit {
  return (evt, payload) => {
    const handler = findPropsHandler(props, evt);
    if (handler) return handler(payload);
    return parentEmit(evt, payload);
  };
}

function findPropsHandler(props: Record<string, any>, evt: string): ((p?: any) => any) | null {
  // update channel
  if (evt.startsWith('update:')) {
    const k = `onUpdate:${evt.slice('update:'.length)}`;
    const h = (props as any)[k];
    if (typeof h === 'function') return h;
  }
  // custom: evt -> onEvt (pascalized)
  const camel = evt.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const pascal = camel.charAt(0).toUpperCase() + camel.slice(1);
  const k2 = `on${pascal}`;
  const h2 = (props as any)[k2];
  return (typeof h2 === 'function') ? h2 : null;
}
