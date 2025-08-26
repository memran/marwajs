import { isRef } from './reactivity';

export type Scope = Record<string, any>;

/**
 * Wrap a scope in a Proxy that:
 *  - preserves prototype chain (so child scope inherits parent)
 *  - auto-unwraps Refs on get (unless disabled)
 *  - writes through to Refs on set
 */
function wrapScope(raw: Scope, { unwrapRefs = true } = {}): Scope {
  return new Proxy(raw, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      return unwrapRefs && isRef(v) ? v.value : v;
    },
    has(t, k) {
      // include prototype chain in `with` lookups
      return k in t;
    },
    set(t, k, v, r) {
      const cur = Reflect.get(t, k, r);
      if (isRef(cur)) {
        (cur as any).value = v;
        return true;
      }
      return Reflect.set(t, k, v, r);
    }
  });
}

/** Evaluate an expression string inside a scope (unwraps refs by default) */
export function evaluate(expr: string, scope: Scope) {
  const s = wrapScope(scope, { unwrapRefs: true });
  // eslint-disable-next-line no-new-func
  const fn = new Function('__s', `with(__s){ return (${expr}); }`);
  return fn(s);
}

/** Evaluate but KEEP refs (used for passing reactive props to children) */
export function evaluateWithOptions(expr: string, scope: Scope, opts: { unwrapRefs?: boolean } = {}) {
  const s = wrapScope(scope, opts);
  // eslint-disable-next-line no-new-func
  const fn = new Function('__s', `with(__s){ return (${expr}); }`);
  return fn(s);
}

export function getByPath(scope: Scope, path: string) {
  const segs = path.split('.');
  let cur: any = scope;
  for (const s of segs) {
    cur = isRef(cur) ? cur.value : cur;
    if (cur == null) return cur;
    cur = cur[s];
  }
  return isRef(cur) ? cur.value : cur;
}

export function setByPath(scope: Scope, path: string, value: any) {
  const segs = path.split('.');
  let cur: any = scope;
  for (let i = 0; i < segs.length - 1; i++) {
    cur = isRef(cur) ? cur.value : cur;
    cur = cur[segs[i]];
    if (cur == null) return;
  }
  const key = segs[segs.length - 1];
  const target = cur[key];
  if (isRef(target)) target.value = value;
  else cur[key] = value;
}

export const toDisplay = (v: any) => (v == null ? '' : String(v));
