// src/compile.ts

import { effect, ref } from './reactivity';

import {
  evaluate,
  evaluateWithOptions,
  getByPath,
  setByPath,
  toDisplay,
  Scope
} from './eval';
import { mountLazyComponent, AppInstance } from './runtime';

const RE = /\{\{([^}]+)\}\}/g;

export interface MountHooks { unmount(): void; }

/** Mount a string template into an element and wire up reactivity/bindings. */
export function mountTemplate(rootEl: Element, template: string, scope: Scope): MountHooks {
  const cleanups: Array<() => void> = [];
  rootEl.innerHTML = template;
  for (const n of Array.from(rootEl.childNodes)) compileSubtree(n, scope, cleanups);
  return {
    unmount() {
      cleanups.forEach(fn => fn());
      rootEl.innerHTML = '';
    }
  };
}

function isComponentTag(tag: string) {
  // Convention: PascalCase HTML tag = component (e.g., RouterLink, RouterView)
  return /^[A-Z]/.test(tag);
}

/** Walk and compile a live DOM subtree with a given scope. */
function compileSubtree(root: Node, scope: Scope, cleanups: Array<() => void>) {
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      bindInterpolations(node as Text, scope, cleanups);
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

      // 0) Component elements: <RouterLink> / <RouterView /> via app._components
      const tag = el.tagName; // UPPERCASE
      if (isComponentTag(tag)) {
        const app = (scope as any).app as AppInstance;
        const reg = (app as any)?._components as Record<string, (props:any, ctx:{app:AppInstance}) => HTMLElement>;
        const name = tag; // e.g., 'ROUTERLINK'
        const comp = reg?.[name] || reg?.[capitalize(name.toLowerCase())]; // tolerate platform uppercase

        if (comp) {
          // collect props (supports :prop="expr" and literal)
          const props = collectComponentProps(el, scope);
          const children = Array.from(el.childNodes); // keep inner content

          const host = comp(props, { app });
          // move children into host
          for (const c of children) host.appendChild(c);

          // swap in DOM
          el.replaceWith(host);

          // compile children inside component host (interpolations, events, etc.)
          for (const child of Array.from(host.childNodes)) compileSubtree(child, scope, cleanups);

          // support optional component unmount
          const maybeUnmount = (host as any)._unmount;
          if (typeof maybeUnmount === 'function') {
            cleanups.push(() => { try { maybeUnmount(); } catch(e) { console.error('[mw:unmount]', e); } });
          }
          return; // component handled its subtree
        }
        // If not registered as component, fall through (treated as normal element)
      }

      // 1) Lazy component placeholder (tagged by the SFC transform)
      const compName = el.getAttribute('data-mw-comp');
      if (compName) {
        const props = collectComponentProps(el, scope);
        const parentInstance = (scope as any).__mwParent; // provided by runtime
        void mountLazyComponent(
          compName,
          el,
          (scope as any).app as AppInstance,
          props,
          parentInstance
        );
        return; // component will manage its own subtree
      }

      // 2) Lists expand the subtree; handle and stop
      if (el.hasAttribute(':for')) {
        bindFor(el, scope, cleanups);
        return;
      }

      // 3) Normal directives, then recurse
      bindDirectives(el, scope, cleanups);
      for (const child of Array.from(el.childNodes)) walk(child);
    }
  };

  walk(root);
}

// --- tiny helper used above ---
function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ===================== Interpolation ===================== */

function bindInterpolations(text: Text, scope: Scope, cleanups: Array<() => void>) {
  const raw = text.data;
  if (!RE.test(raw)) return;
  RE.lastIndex = 0;

  const tokens: Array<string | ((s: Scope) => any)> = [];
  let last = 0; let m: RegExpExecArray | null;
  while ((m = RE.exec(raw))) {
    if (m.index > last) tokens.push(raw.slice(last, m.index));
    const expr = m[1].trim();
    tokens.push((s: Scope) => evaluate(expr, s));
    last = RE.lastIndex;
  }
  if (last < raw.length) tokens.push(raw.slice(last));

  cleanups.push(effect(() => {
    text.data = tokens.map(t => typeof t === 'function' ? toDisplay(t(scope)) : t).join('');
  }));
}

/* ===================== Directives ===================== */

function bindDirectives(el: HTMLElement, scope: Scope, cleanups: Array<() => void>) {
  const specials = new Set([':text', ':html', ':show', ':model']);
  const attrs = Array.from(el.attributes);

  for (const attr of attrs) {
    const name = attr.name;
    const val = attr.value.trim();

    if (name === ':text') {
      cleanups.push(effect(() => { el.textContent = toDisplay(evaluate(val, scope)); }));
      el.removeAttribute(name);
      continue;
    }
    if (name === ':html') {
      cleanups.push(effect(() => { el.innerHTML = toDisplay(evaluate(val, scope)); }));
      el.removeAttribute(name);
      continue;
    }
    if (name === ':show') {
      cleanups.push(effect(() => {
        const ok = !!evaluate(val, scope);
        el.style.display = ok ? '' : 'none';
      }));
      el.removeAttribute(name);
      continue;
    }
    if (name === ':model') {
      bindModel(el, val, scope, cleanups);
      el.removeAttribute(name);
      continue;
    }

    // Generic ":" — event if element supports on<name>, else attribute binding
    if (name.startsWith(':') && !specials.has(name)) {
      const token = name.slice(1); // "click" | "href" | ...
      const isEvent = ('on' + token) in el;

      if (isEvent) {
        const handler = (e: Event) => {
          const local = Object.create(scope);
          (local as any).$event = e;
          void evaluate(val, local); // keep proto chain for parent funcs
        };
        el.addEventListener(token, handler);
        cleanups.push(() => el.removeEventListener(token, handler));
        el.removeAttribute(name);
      } else {
        const bindAttr = token;
        cleanups.push(effect(() => {
          const v = evaluate(val, scope);
          if (v == null || v === false) el.removeAttribute(bindAttr);
          else el.setAttribute(bindAttr, String(v));
        }));
        el.removeAttribute(name);
      }
    }
  }
}

/* ===================== :for (lists) ===================== */
/* Syntax: :for="item in list"  OR  :for="(item, index) in list"
   Optional: :key="expr" for keyed ordering/reuse semantics (recreate for now) */

function parseForExpression(expr: string) {
  const m = expr.match(/^\s*(?:\(\s*([\w$]+)\s*,\s*([\w$]+)\s*\)|([\w$]+))\s+in\s+(.+)\s*$/);
  if (!m) throw new Error(`Invalid :for expression: ${expr}`);
  const itemVar = (m[1] || m[3])!;
  const indexVar = m[2] || null;
  const listExpr = m[4]!;
  return { itemVar, indexVar, listExpr };
}

type ItemRecord = {
  node: HTMLElement;
  cleanups: Array<() => void>;
  key: any;
  itemRef: any;   // Ref to current item value
  indexRef?: any; // Ref to current index
};

function bindFor(templateEl: HTMLElement, scope: Scope, cleanups: Array<() => void>) {
  const forExpr = templateEl.getAttribute(':for')!;
  const keyExpr = templateEl.getAttribute(':key') || null;

  templateEl.removeAttribute(':for');
  templateEl.removeAttribute(':key');

  const anchor = document.createComment('for');
  const parent = templateEl.parentNode!;
  parent.insertBefore(anchor, templateEl);
  parent.removeChild(templateEl);

  const { itemVar, indexVar, listExpr } = parseForExpression(forExpr);

  let keyToRecord = new Map<any, ItemRecord>();

  function disposeRecord(rec: ItemRecord) {
    rec.cleanups.forEach(fn => fn());
  }

  cleanups.push(effect(() => {
    const list: any[] = evaluate(listExpr, scope) ?? [];

    // Build desired ordered records (reuse by key if possible)
    const desired: ItemRecord[] = [];
    const nextKeyToRecord = new Map<any, ItemRecord>();

    for (let i = 0; i < list.length; i++) {
      const rawItem = list[i];

      // Compute key using a temp child scope (do not mutate existing scopes here)
      const tempScope: Scope = Object.create(scope);
      (tempScope as any)[itemVar] = rawItem;
      if (indexVar) (tempScope as any)[indexVar] = i;

      const key = keyExpr
        ? evaluateWithOptions(keyExpr, tempScope, { unwrapRefs: true })
        : (rawItem && typeof rawItem === 'object' ? rawItem : i);

      let rec = keyToRecord.get(key);

      if (!rec) {
        // Create new record: build reactive child scope with refs
        const itemRef = ref(rawItem);
        const indexRef = indexVar ? ref(i) : undefined;

        const childScope: Scope = Object.create(scope);
        (childScope as any)[itemVar] = itemRef;
        if (indexVar) (childScope as any)[indexVar] = indexRef;

        const node = templateEl.cloneNode(true) as HTMLElement;
        const recCleanups: Array<() => void> = [];
        compileSubtree(node, childScope, recCleanups);

        rec = { node, cleanups: recCleanups, key, itemRef, indexRef };
      } else {
        // Reuse existing node; just update refs
        rec.itemRef.value = rawItem;
        if (rec.indexRef) rec.indexRef.value = i;
      }

      desired.push(rec);
      nextKeyToRecord.set(key, rec);
    }

    // DOM reconciliation by order using a single forward pass
    let cursor: ChildNode = anchor;
    for (const rec of desired) {
      const next = cursor.nextSibling;
      if (rec.node !== next) {
        parent.insertBefore(rec.node, next || null); // moves or inserts
      }
      cursor = rec.node;
    }

    // Remove old records that no longer exist
    for (const [oldKey, oldRec] of keyToRecord.entries()) {
      if (!nextKeyToRecord.has(oldKey)) {
        if (oldRec.node.parentNode === parent) parent.removeChild(oldRec.node);
        disposeRecord(oldRec);
      }
    }

    keyToRecord = nextKeyToRecord;
  }));
}



/* ===================== :model ===================== */

function bindModel(el: HTMLElement, path: string, scope: Scope, cleanups: Array<() => void>) {
  const inputLike = (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement);

  const read = () => {
    if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.checked;
    if (el instanceof HTMLInputElement && el.type === 'radio') return el.value;
    return (inputLike as any).value;
  };
  const write = (v: any) => {
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!v;
    else (inputLike as any).value = v ?? '';
  };

  const onInput = () => setByPath(scope, path, read());
  el.addEventListener('input', onInput);
  el.addEventListener('change', onInput);
  cleanups.push(() => {
    el.removeEventListener('input', onInput);
    el.removeEventListener('change', onInput);
  });

  cleanups.push(effect(() => {
    const v = getByPath(scope, path);
    write(v);
  }));
}

/* ===================== Component props collector ===================== */
/** Build props object for a lazy component.
 *  - `:prop="expr"` → evaluate in current scope, **preserving refs**
 *  - `prop="literal"` → pass string literal
 */
function collectComponentProps(el: HTMLElement, scope: Scope) {
  const props: Record<string, any> = {};
  for (const a of Array.from(el.attributes)) {
    if (a.name === 'data-mw-comp') continue; // internal marker
    if (a.name.startsWith(':')) {
      const key = a.name.slice(1);
      // Keep refs so child receives reactivity by reference.
      props[key] = evaluateWithOptions(a.value.trim(), Object.create(scope), { unwrapRefs: false });
    } else {
      props[a.name] = a.value;
    }
  }
  return props;
}
