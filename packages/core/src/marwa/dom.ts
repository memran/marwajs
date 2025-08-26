import { bindElement, __eval_raw } from './directives';
import { signal, isSignal, effect, type Signal } from './reactivity';

export type AsyncComponentLoader = () => Promise<{ default: Component }>;

export interface Component {
  name?: string;
  template: string;
  setup?: (ctx: SetupContext) => void | Record<string, any>;
  styles?: string;
}
export interface SetupContext {
  app: {
    registerComponent: (name: string, comp: Component | AsyncComponentLoader) => void;
    getComponent: (name: string) => Component | AsyncComponentLoader | undefined;
    inject<T>(token: string): T | undefined;
    provide<T>(token: string, value: T): void;
  };
  props: Record<string, any>;
  ctx: Record<string, any>;
}

/* lifecycles */
type Hooks = { beforeMount: Array<() => void>; mounted: Array<() => void>; beforeUnmount: Array<() => void>; unmounted: Array<() => void>; };
type Instance = { hooks: Hooks; ctx: any; el: Element | null };
const stack: Instance[] = [];
let current: Instance | null = null;
function push(i: Instance){ stack.push(i); current = i; }
function pop(){ stack.pop(); current = stack[stack.length-1] || null; }
export function onBeforeMount(fn: () => void){ current?.hooks.beforeMount.push(fn); }
export function onMounted(fn: () => void){ current?.hooks.mounted.push(fn); }
export function onBeforeUnmount(fn: () => void){ current?.hooks.beforeUnmount.push(fn); }
export function onUnmounted(fn: () => void){ current?.hooks.unmounted.push(fn); }

/* helpers */
export function defineComponent<C extends Component>(c: C): C { return c; }
function ensureStyle(id: string, css?: string){ if(!css) return; if(document.getElementById(id)) return; const s=document.createElement('style'); s.id=id; s.textContent=css; document.head.appendChild(s); }
function parseLiteral(raw: string): any {
  const v = raw.trim();
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (v === 'undefined') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('[')&&v.endsWith(']'))||(v.startsWith('{')&&v.endsWith('}'))) { try { return JSON.parse(v); } catch {} }
  return raw;
}
type Collected = { values: Record<string, any>; dynamics: Record<string, string> };
function collectProps(el: Element, parentCtx: any): Collected {
  const values: Record<string, any> = {};
  const dynamics: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    const name = a.name, val = a.value;
    if (name.startsWith(':')) { const key = name.slice(1); dynamics[key] = val; values[key] = __eval_raw(val, parentCtx); }
    else { values[name] = val === '' ? true : parseLiteral(val); }
  }
  return { values, dynamics };
}
function linkDynamicProps(childCtx: any, props: Collected, parentCtx: any) {
  for (const [key, expr] of Object.entries(props.dynamics)) {
    const raw = props.values[key];
    if (isSignal(raw)) { childCtx[key] = raw; if (childCtx.$props) childCtx.$props[key] = raw; continue; }
    const s: Signal<any> = isSignal(childCtx[key]) ? childCtx[key] : signal(raw);
    childCtx[key] = s; if (childCtx.$props) childCtx.$props[key] = s;
    effect(() => { s.value = __eval_raw(expr, parentCtx); });
  }
}

/* nested resolution (lazy) */
async function resolveAndMountNested(container: HTMLElement, appCtx: SetupContext['app'], parentCtx: any) {
  const snapshot = Array.from(container.querySelectorAll('*'));
  for (const el of snapshot) {
    const tag = el.tagName;
    const entry = appCtx.getComponent(tag) || appCtx.getComponent(tag.charAt(0) + tag.slice(1).toLowerCase());
    if (!entry) continue;

    let comp: Component | undefined;
    if (typeof entry === 'function') {
      const mod = await (entry as AsyncComponentLoader)();
      comp = (mod as any).default as Component;
    } else comp = entry as Component;
    if (!comp) continue;

    const wrap = document.createElement('div');
    const collected = collectProps(el, parentCtx);
    const childCtx = await mountComponent(wrap, comp, appCtx, collected.values);
    linkDynamicProps(childCtx, collected, parentCtx);
    el.replaceWith(...Array.from(wrap.childNodes));
  }
}

/* public mount */
export async function mountComponent(
  rootEl: Element,
  compOrLoader: Component | AsyncComponentLoader,
  appCtx: SetupContext['app'],
  incomingProps: Record<string, any> = {}
): Promise<Record<string, any>> {
  const prev: Instance | undefined = (rootEl as any).__marwa_instance;
  if (prev) {
    try { prev.hooks.beforeUnmount.forEach(fn => { try { fn(); } catch {} }); } catch {}
    (rootEl as any).__marwa_instance = undefined;
    try { prev.hooks.unmounted.forEach(fn => { try { fn(); } catch {} }); } catch {}
  }

  const comp: Component = typeof compOrLoader === 'function'
    ? ((await (compOrLoader as AsyncComponentLoader)()).default as Component)
    : (compOrLoader as Component);

  ensureStyle(`marwa-style-${comp.name ?? 'anon'}`, comp.styles);

  const host = document.createElement('div');
  host.innerHTML = comp.template.trim();

  const hooks: Hooks = { beforeMount: [], mounted: [], beforeUnmount: [], unmounted: [] };
  const ctx: any = Object.create(null);
  ctx.$props = incomingProps;
  Object.assign(ctx, incomingProps);

  const inst: Instance = { hooks, ctx, el: rootEl };
  push(inst);

  if (typeof comp.setup === 'function') {
    const maybe = comp.setup({ app: appCtx, props: incomingProps, ctx });
    if (maybe && typeof maybe === 'object') Object.assign(ctx, maybe);
  }

  hooks.beforeMount.forEach(fn => { try { fn(); } catch {} });

  await resolveAndMountNested(host, appCtx, ctx);
  for (const el of Array.from(host.children)) bindElement(el as Element, ctx);

  rootEl.replaceChildren(...Array.from(host.childNodes));
  (rootEl as any).__marwa_instance = inst;

  hooks.mounted.forEach(fn => { try { fn(); } catch {} });

  pop();
  return ctx;
}
