import { isRef } from './reactivity';

export type Scope = Record<string, any>;

const FN_CACHE = new Map<string, Function>();

function isRefError(e: any) {
  return e && (e.name === 'ReferenceError' || /is not defined/.test(String(e)));
}
function extractMissingIdent(msg: string): string | null {
  // handles: "Login is not defined", "'Login' is not defined" (various engines)
  const m = msg.match(/'?([A-Za-z_$][\w$]*)'?\s+is not defined/);
  return m ? m[1] : null;
}

export function evaluate(code: string, scope: any) {
  let fn = FN_CACHE.get(code);
  if (!fn) {
    fn = new Function('__s', `with(__s){ return (${code}) }`);
    FN_CACHE.set(code, fn);
  }

  let attempts = 0;
  // try-evaluate; on missing identifier, auto-provision via app.form and retry
  for (; attempts < 3; attempts++) {
    try {
      return fn!(scope);
    } catch (err: any) {
      if (!isRefError(err)) throw err;

      const id = extractMissingIdent(err.message || '');
      const looksLikeForm = id && /^[A-Z][A-Za-z0-9_]*$/.test(id);
      const app = scope?.app;
      const formSvc = app?.inject ? app.inject('form') : undefined;

      if (looksLikeForm && formSvc) {
        // ensure a model exists & attach to scope, then retry
        try {
          const model = formSvc.useModel(id);
          Object.defineProperty(scope, id, {
            value: model,
            configurable: true,
            enumerable: true,
            writable: true,
          });
          continue; // retry
        } catch {
          // last resort: define empty, then model
          try {
            formSvc.defineForm(id, {});
            const model = formSvc.useModel(id);
            Object.defineProperty(scope, id, {
              value: model, configurable: true, enumerable: true, writable: true,
            });
            continue; // retry
          } catch (e2) {
            throw err; // give up; original error is more relevant
          }
        }
      }

      // not a form-like missing ident → bubble up
      throw err;
    }
  }

  // if we got here something else kept failing
  return fn!(scope);
}
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
// export function evaluate(expr: string, scope: Scope) {
//   const s = wrapScope(scope, { unwrapRefs: true });
//   // eslint-disable-next-line no-new-func
//   const fn = new Function('__s', `with(__s){ return (${expr}); }`);
//   return fn(s);
// }

/** Evaluate but KEEP refs (used for passing reactive props to children) */
export function evaluateWithOptions(expr: string, scope: Scope, opts: { unwrapRefs?: boolean } = {}) {
  const s = wrapScope(scope, opts);
  // eslint-disable-next-line no-new-func
  const fn = new Function('__s', `with(__s){ return (${expr}); }`);
  return fn(s);
}

export function getByPath(obj: any, path: string) {
  const parts = String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
    // unwrap ref at each hop so effect tracks .value
    if (isRef(cur)) cur = cur.value;
  }
  return cur;
}

export function setByPath(obj: any, path: string, val: any) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null) cur[p] = {};
    // unwrap intermediate refs
    if (isRef(cur[p])) cur[p] = cur[p].value;
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  const leaf = cur[last];
  // if leaf is a ref, set .value to keep reactivity
  if (isRef(leaf)) leaf.value = val;
  else cur[last] = val;
}

export const toDisplay = (v: any) => (v == null ? '' : String(v));
