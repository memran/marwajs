// src/form.ts — KISS builder that pairs with your compile.ts (string paths).
// - No validation
// - Reactive fields via internal ref-map
// - Model proxy (Login.*) so property reads hit ref.value (track) and sets update ref.value
// - formSubmit() prevents refresh and passes a deep snapshot to your handler

import { definePlugin } from './runtime';
import { ref } from './reactivity';

type AnyRecord = Record<string, any>;
type RefLeaf = ReturnType<typeof ref>;

export interface FormInstance<TValues extends AnyRecord = AnyRecord> {
  id: string;
  /** Plain initial snapshot (for reset seeds) */
  initial: TValues;
  /** Reactive view (proxy) backed by refs; JSON.stringify will re-run via effects */
  values: TValues;

  get<T = unknown>(path: string): T;
  set(path: string, val: unknown): this;
  reset(next?: Partial<TValues>): void;
}

export interface FormService {
  _forms: Map<string, FormInstance & { __refs: Map<string, RefLeaf> }>;
  _models: Map<string, any>;

  defineForm<TValues extends AnyRecord = AnyRecord>(
    id: string,
    initial?: Partial<TValues>
  ): FormInstance<TValues>;

  ensureForm(id: string): FormInstance;
  useForm<TValues extends AnyRecord = AnyRecord>(id: string): FormInstance<TValues>;
  useModel(id: string): any;

  /** Use inside :submit="form.formSubmit('Login', onSubmit, $event)" */
  formSubmit(id: string, onSubmit?: (values: AnyRecord, form: FormInstance) => void, ev?: Event): void;
}

/* ------------ small utils ------------ */
const isObj = (x: unknown): x is AnyRecord => !!x && typeof x === 'object' && !Array.isArray(x);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function walk(obj: AnyRecord, fn: (path: string, val: any) => void, base = '') {
  for (const k of Object.keys(obj || {})) {
    const p = base ? base + '.' + k : k;
    const v = (obj as any)[k];
    if (isObj(v)) walk(v, fn, p);
    else fn(p, v);
  }
}

/* Build/ensure a ref for dotted path in a refs map */
function ensureRef(refs: Map<string, RefLeaf>, path: string): RefLeaf {
  let r = refs.get(path);
  if (!r) { r = ref(undefined); refs.set(path, r); }
  return r;
}

/* Values proxy reads/writes via the refs map */
function makeValuesProxy(refs: Map<string, RefLeaf>) {
  // shallow object facade for top-level keys; paths stay dotted internally
  const computeTop = () => {
    const top = new Set<string>();
    for (const p of refs.keys()) top.add(p.split('.')[0]);
    return Array.from(top);
  };

  const handler: ProxyHandler<any> = {
    get(_t, key: string | symbol) {
      if (typeof key === 'symbol') return undefined;
      // read either a leaf ("email") or a nested object ("user")
      const k = String(key);
      // exact leaf
      const leaf = refs.get(k);
      if (leaf) return leaf.value;

      // nested: synthesize a child proxy filtered by prefix
      const prefix = k + '.';
      const hasChild = Array.from(refs.keys()).some(p => p.startsWith(prefix));
      if (!hasChild) return undefined;

      return new Proxy({}, {
        get(_ct, sub: string | symbol) {
          if (typeof sub === 'symbol') return undefined;
          const path = prefix + String(sub);
          const r = ensureRef(refs, path);
          return r.value;
        },
        set(_ct, sub: string | symbol, value: any) {
          if (typeof sub === 'symbol') return false;
          const path = prefix + String(sub);
          const r = ensureRef(refs, path);
          r.value = value;
          return true;
        },
        ownKeys() {
          const keys = new Set<string>();
          for (const p of refs.keys()) if (p.startsWith(prefix)) keys.add(p.slice(prefix.length).split('.')[0]);
          return Array.from(keys);
        },
        getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; }
      });
    },

    set(_t, key: string | symbol, value: any) {
      if (typeof key === 'symbol') return false;
      const k = String(key);
      if (isObj(value)) {
        // replace subtree by setting leaves
        // clear old subtree
        const prefix = k + '.';
        for (const p of Array.from(refs.keys())) if (p === k || p.startsWith(prefix)) refs.delete(p);
        // write new subtree
        walk(value, (p, v) => { ensureRef(refs, `${k}.${p}`).value = v; });
      } else {
        ensureRef(refs, k).value = value;
      }
      return true;
    },

    ownKeys() { return computeTop(); },
    getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; }
  };

  return new Proxy({}, handler);
}

/* Model proxy (Login.*) delegates to values proxy */
function makeModelProxy(form: FormInstance & { __refs: Map<string, RefLeaf> }) {
  const passthrough = new Set(['id','initial','values','get','set','reset']);
  return new Proxy({}, {
    get(_t, key: string | symbol) {
      if (typeof key === 'symbol') return undefined;
      if (passthrough.has(String(key))) return (form as any)[key];
      if ((form as any)[key] !== undefined) return (form as any)[key];
      return (form.values as any)[key];
    },
    set(_t, key: string | symbol, value: any) {
      if (typeof key === 'symbol') return false;
      if ((form as any)[key] !== undefined) { (form as any)[key] = value; return true; }
      (form.values as any)[key] = value;
      return true;
    },
    ownKeys() { return Reflect.ownKeys(form.values as any); },
    getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; }
  });
}

export const FormPlugin = definePlugin({
  name: 'form',

  provides: {
    form: {
      _forms: new Map(),
      _models: new Map(),

      defineForm(id: string, initial?: AnyRecord) {
        if (!id || typeof id !== 'string') throw new Error('[mw:form] defineForm(id) requires a string');

        const exist = this._forms.get(id) as (FormInstance & { __refs: Map<string, RefLeaf> }) | undefined;
        if (exist) {
          // seed only missing leaves
          if (initial && isObj(initial)) {
            walk(initial, (p, v) => {
              const r = exist.__refs.get(p);
              if (!r || r.value === undefined) (exist as any).set(p, v);
            });
            exist.initial = { ...(exist.initial || {}), ...clone(initial) };
          }
          return exist;
        }

        const refs = new Map<string, RefLeaf>();
        if (initial && isObj(initial)) walk(initial, (p, v) => refs.set(p, ref(clone(v))));
        const valuesProxy = makeValuesProxy(refs);

        const form: FormInstance & { __refs: Map<string, RefLeaf> } = {
          id,
          initial: clone((initial ?? {}) as AnyRecord),
          values: valuesProxy as any,
          __refs: refs,

          get(path: string) {
            return ensureRef(refs, path).value;
          },
          set(path: string, val: unknown) {
            ensureRef(refs, path).value = val;
            return this;
          },
          reset(next?: AnyRecord) {
            // wipe and reseed from (initial + next)
            refs.clear();
            const seed = next ? { ...(this.initial as AnyRecord), ...(next as AnyRecord) } : this.initial;
            if (seed && isObj(seed)) walk(seed, (p, v) => refs.set(p, ref(clone(v))));
            // valuesProxy still points to the same refs map, so stays reactive
          }
        };

        this._forms.set(id, form);
        this._models.set(id, makeModelProxy(form));
        return form;
      },

      ensureForm(id: string) {
        let f = this._forms.get(id);
        if (!f) f = this.defineForm(id, {});
        return f!;
      },

      useForm(id: string) {
        const f = this._forms.get(id);
        if (!f) throw new Error(`[mw:form] useForm('${id}') before defineForm('${id}', ...)`);
        return f;
      },

      useModel(id: string) {
        let m = this._models.get(id);
        if (m) return m;
        const f = this.ensureForm(id) as any;
        m = makeModelProxy(f);
        this._models.set(id, m);
        return m;
      },

      formSubmit(id: string, onSubmit?: (values: AnyRecord, form: FormInstance) => void, ev?: Event) {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        const f = this.ensureForm(id);
        // pass a plain deep snapshot so console/alerts look correct
        const snapshot = clone(f.values);
        if (onSubmit) onSubmit(snapshot, f);
      },
    } as FormService
  },

  setup() { /* no-op */ }
});
