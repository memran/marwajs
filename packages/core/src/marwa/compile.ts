import { effect } from './reactivity';
import { evaluate, evaluateWithOptions, getByPath, setByPath, toDisplay, Scope } from './eval';
import { mountLazyComponent, AppInstance } from './runtime';

const RE = /\{\{([^}]+)\}\}/g;

export interface MountHooks { unmount(): void; }

export function mountTemplate(rootEl: Element, template: string, scope: Scope): MountHooks {
  const cleanups: Array<() => void> = [];
  rootEl.innerHTML = template;
  for (const n of Array.from(rootEl.childNodes)) compileSubtree(n, scope, cleanups);
  return { unmount() { cleanups.forEach(fn => fn()); rootEl.innerHTML = ''; } };
}

function compileSubtree(root: Node, scope: Scope, cleanups: Array<() => void>) {
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      bindInterpolations(node as Text, scope, cleanups);
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

      // Component placeholder (inserted by plugin)
      const compName = el.getAttribute('data-mw-comp');
      if (compName) {
        const props = collectComponentProps(el, scope);
        void mountLazyComponent(compName, el, (scope as any).app as AppInstance, props);
        return; // component owns its subtree
      }

      // :for expands the subtree, so handle first and stop
      if (el.hasAttribute(':for')) {
        bindFor(el, scope, cleanups);
        return;
      }

      bindDirectives(el, scope, cleanups);
      for (const child of Array.from(el.childNodes)) walk(child);
    }
  };
  walk(root);
}

/* ---------------- Interpolation ---------------- */

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

/* ---------------- Directives ---------------- */

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

    if (name.startsWith(':') && !specials.has(name)) {
      const token = name.slice(1); // "click", "href", etc.
      const isEvent = ('on' + token) in el;

      if (isEvent) {
        const handler = (e: Event) => {
          const local = Object.create(scope);
          (local as any).$event = e;
          void evaluate(val, local);
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

/* ---------------- :for with keyed diff ---------------- */

function parseForExpression(expr: string) {
  // "(item, i) in list" | "item in list"
  const m = expr.match(/^\s*(?:\(\s*([\w$]+)\s*,\s*([\w$]+)\s*\)|([\w$]+))\s+in\s+(.+)\s*$/);
  if (!m) throw new Error(`Invalid :for expression: ${expr}`);
  const itemVar = (m[1] || m[3])!;
  const indexVar = m[2] || null;
  const listExpr = m[4]!;
  return { itemVar, indexVar, listExpr };
}

type ItemRecord = { node: HTMLElement; cleanups: Array<() => void>; key: any };

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
    const newKeyToRecord = new Map<any, ItemRecord>();

    // We'll rebuild the region between anchor and the next non-loop node.
    // Track insertion point with cursor.
    let cursor: ChildNode = anchor;

    for (let i = 0; i < list.length; i++) {
      const val = list[i];

      // Child scope with inheritance (so parent funcs are visible)
      const childScope: Scope = Object.create(scope);
      (childScope as any)[itemVar] = val;
      if (indexVar) (childScope as any)[indexVar] = i;

      // Compute key (preserve refs inside key eval if needed)
      const key = keyExpr
        ? evaluateWithOptions(keyExpr, childScope, { unwrapRefs: true })
        : (val && typeof val === 'object' ? (val as any) : i);

      // Recreate each record (tiny, deterministic)
      const clone = templateEl.cloneNode(true) as HTMLElement;
      const recCleanups: Array<() => void> = [];
      compileSubtree(clone, childScope, recCleanups);
      const rec: ItemRecord = { node: clone, cleanups: recCleanups, key };

      // Insert after cursor
      const before = cursor.nextSibling;
      parent.insertBefore(rec.node, before || null);
      cursor = rec.node;

      newKeyToRecord.set(key, rec);
    }

    // Remove any old nodes not present now
    for (const [oldKey, oldRec] of keyToRecord.entries()) {
      if (!newKeyToRecord.has(oldKey)) {
        if (oldRec.node.parentNode === parent) parent.removeChild(oldRec.node);
        disposeRecord(oldRec);
      }
    }

    keyToRecord = newKeyToRecord;
  }));

  // Stop processing other directives on the template element
  return;
}

/* ---------------- :model ---------------- */

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

/* ---------------- props collector for components ---------------- */

function collectComponentProps(el: HTMLElement, scope: Scope) {
  const props: Record<string, any> = {};
  for (const a of Array.from(el.attributes)) {
    if (a.name === 'data-mw-comp') continue;
    if (a.name.startsWith(':')) {
      const key = a.name.slice(1);
      // keep refs intact so child sees reactivity
      props[key] = evaluateWithOptions(a.value.trim(), Object.create(scope), { unwrapRefs: false });
    } else {
      props[a.name] = a.value; // literal
    }
  }
  return props;
}
