// FormValidationPlugin — works with your current form.ts + compile.ts
// Adds per-field rules + whole-form Zod schema validation with reactive errors/touched/valid.

import { definePlugin } from './runtime';
import { ref } from './reactivity';

type AnyRecord = Record<string, any>;
type Ref<T> = ReturnType<typeof ref<T>>;
type Validator = (value: unknown, values?: AnyRecord) => string | null | undefined;

// We duck-type Zod to avoid importing types if you don’t want them here.
// If you do `import { z } from 'zod'`, just pass instances to setSchema().
type ZodSchemaLike = {
  safeParse: (v: unknown) => { success: true; data: any } | { success: false; error: { errors: Array<{ path: (string|number)[]; message: string }> } }
  // Optional, for per-field sub-schema lookup when possible (only on ZodObject)
  _def?: { shape?: () => Record<string, ZodSchemaLike> } | any
  shape?: () => Record<string, ZodSchemaLike> // some zod versions expose shape() here
};

type FormState = {
  rules: Record<string, Validator[]>;
  schema?: ZodSchemaLike | null;
  errors: Map<string, Ref<string | null>>;
  touched: Map<string, Ref<boolean>>;
  valid: Ref<boolean>;
  dirty: Ref<boolean>;
};

const isObj = (x: unknown): x is AnyRecord => !!x && typeof x === 'object' && !Array.isArray(x);

/* ---------------- helpers ---------------- */

function ensureRef<T>(map: Map<string, Ref<T>>, key: string, init: T): Ref<T> {
  let r = map.get(key);
  if (!r) { r = ref(init) as Ref<T>; map.set(key, r); }
  return r;
}

/** Proxy view so `Login.errors.email` is reactive */
function proxyFromRefMap<T>(map: Map<string, Ref<T>>, defaultVal: T) {
  return new Proxy({}, {
    get(_t, key: string | symbol) {
      if (typeof key === 'symbol') return undefined;
      return ensureRef(map, String(key), defaultVal).value;
    },
    set(_t, key: string | symbol, value: any) {
      if (typeof key === 'symbol') return false;
      ensureRef(map, String(key), defaultVal).value = value as T;
      return true;
    },
    ownKeys() { return Array.from(map.keys()); },
    getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; }
  });
}

/** Flatten Zod issues: [["user.email"], "msg"] etc. */
function zodErrorsToMap(issues: Array<{ path: (string|number)[], message: string }>) {
  const m = new Map<string, string>();
  for (const it of issues) {
    const path = it.path.map(p => String(p)).join('.');
    m.set(path, it.message);
  }
  return m;
}

/** Try to find a sub-schema for a dotted path in a Zod object */
function getSubSchema(schema: any, dottedPath: string): ZodSchemaLike | null {
  const segs = String(dottedPath).split('.');
  let cur = schema;
  for (const s of segs) {
    if (!cur) return null;
    const shape = (cur?.shape?.() ?? cur?._def?.shape?.()) as Record<string, ZodSchemaLike> | undefined;
    if (!shape) return null;
    cur = shape[s];
  }
  return cur || null;
}

/* ---------------- built-in simple validators (optional convenience) ---------------- */
const validators = {
  required: (msg = 'Required'): Validator => (val) =>
    val == null || val === '' || (Array.isArray(val) && val.length === 0) ? msg : null,

  min: (n: number, msg?: string): Validator => (val) => {
    const s = val == null ? '' : String(val);
    return s.length < n ? (msg ?? `Min ${n} chars`) : null;
  },

  max: (n: number, msg?: string): Validator => (val) => {
    const s = val == null ? '' : String(val);
    return s.length > n ? (msg ?? `Max ${n} chars`) : null;
  },

  email: (msg = 'Invalid email'): Validator => (val) => {
    if (!val) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val)) ? null : msg;
  },

  pattern: (re: RegExp, msg = 'Invalid format'): Validator => (val) => {
    if (!val) return null;
    return re.test(String(val)) ? null : msg;
  },

  custom: (fn: (val: unknown, values?: AnyRecord) => string | null | undefined): Validator =>
    (val, values) => fn(val, values) ?? null,
} as const;

/* ---------------- plugin ---------------- */

export const FormValidationPlugin = definePlugin({
  name: 'form-validation',

  setup(app) {
    const formSvc = app.inject<any>('form');
    if (!formSvc) {
      console.warn('[mw:form-validation] Base form service not found. Install FormPlugin before this plugin.');
      return;
    }

    const stateById = new Map<string, FormState>();

    const ensureState = (id: string): FormState => {
      let st = stateById.get(id);
      if (!st) {
        st = {
          rules: {},
          schema: null,
          errors: new Map(),
          touched: new Map(),
          valid: ref(true),
          dirty: ref(false),
        };
        stateById.set(id, st);

        // Patch the live form/model to expose reactive props
        const f = formSvc.ensureForm(id) as any;
        if (!('errors' in f)) Object.defineProperty(f, 'errors', { enumerable: true, configurable: true, value: proxyFromRefMap(st.errors, null) });
        if (!('touched' in f)) Object.defineProperty(f, 'touched', { enumerable: true, configurable: true, value: proxyFromRefMap(st.touched, false) });
        if (!('valid' in f)) Object.defineProperty(f, 'valid', { enumerable: true, configurable: true, get() { return st!.valid.value; } });
      }
      return st;
    };

    /** Public API: attach per-field rules */
    formSvc.setRules = (id: string, rules: Record<string, Validator[]>) => {
      const st = ensureState(id);
      st.rules = rules || {};
      for (const p of Object.keys(st.rules)) {
        ensureRef(st.errors, p, null);
        ensureRef(st.touched, p, false);
      }
      formSvc.validate(id);
    };

    /** Public API: attach a Zod schema */
    formSvc.setSchema = (id: string, schema: ZodSchemaLike) => {
      const st = ensureState(id);
      st.schema = schema || null;
      formSvc.validate(id);
    };

    /** Validate a single field (rules + sub-schema if possible) */
    formSvc.validateField = (id: string, path: string) => {
      const f = formSvc.ensureForm(id);
      const st = ensureState(id);

      const val = f.get(path);
      let msg: string | null = null;

      // 1) per-field rules (priority)
      const fns = st.rules[path] || [];
      for (const fn of fns) { const m = fn(val, f.values); if (m) { msg = m; break; } }

      // 2) sub-schema (only if rules didn’t already produce a message)
      if (!msg && st.schema) {
        const sub = getSubSchema(st.schema, path);
        if (sub && typeof sub.safeParse === 'function') {
          const r = sub.safeParse(val);
          if (!r.success) msg = r.error.errors[0]?.message || 'Invalid';
        }
      }

      ensureRef(st.errors, path, null).value = msg;

      // recompute global validity from all known fields (rules keys + prior schema issues)
      let ok = true;
      // Ensure any schema keys get a slot too by attempting a form-wide pass when needed
      if (st.schema) {
        const res = st.schema.safeParse(f.values);
        if (!res.success) {
          const zmap = zodErrorsToMap(res.error.errors);
          for (const [p, m] of zmap) {
            // do not overwrite rule errors already set
            const cur = ensureRef(st.errors, p, null).value;
            if (!cur) ensureRef(st.errors, p, null).value = m;
          }
        } else {
          // clear schema-only errors that may have existed
          for (const [p, r] of st.errors) {
            if (!(p in st.rules)) r.value = r.value; // keep unless overridden below
          }
        }
      }
      for (const [, r] of st.errors) {
        if (r.value) { ok = false; break; }
      }
      st.valid.value = ok;
      return !msg;
    };

    /** Validate entire form: merge rules + schema errors */
    formSvc.validate = (id: string) => {
      const f = formSvc.ensureForm(id);
      const st = ensureState(id);

      // Clear previous error state (don’t delete maps to keep proxies stable)
      for (const [, r] of st.errors) r.value = null;

      // 1) rules pass
      let ok = true;
      for (const [path, fns] of Object.entries(st.rules)) {
        const val = f.get(path);
        let first: string | null = null;
        for (const fn of fns) { const m = fn(val, f.values); if (m) { first = m; break; } }
        ensureRef(st.errors, path, null).value = first;
        if (fns.length && first) ok = false;
      }

      // 2) schema pass (whole form)
      if (st.schema) {
        const res = st.schema.safeParse(f.values);
        if (!res.success) {
          const zmap = zodErrorsToMap(res.error.errors);
          for (const [p, m] of zmap) {
            // Only set if a rule did NOT already produce a message
            const cur = ensureRef(st.errors, p, null).value;
            if (!cur) ensureRef(st.errors, p, null).value = m;
            ok = false;
          }
        }
      }

      st.valid.value = ok;
      return ok;
    };

    /** Wire these to inputs if you want live validation UX */
    formSvc.onChange = (id: string, path: string, _e?: Event) => {
      const st = ensureState(id);
      st.dirty.value = true;
      // validate this path if we have either a rule or a sub-schema
      const need = st.rules[path] || (st.schema && getSubSchema(st.schema, path));
      if (need) formSvc.validateField(id, path);
    };
    formSvc.onBlur = (id: string, path: string, _e?: Event) => {
      const st = ensureState(id);
      ensureRef(st.touched, path, false).value = true;
      const need = st.rules[path] || (st.schema && getSubSchema(st.schema, path));
      if (need) formSvc.validateField(id, path);
    };

    /** Wrap submit: validate first; only call handler if valid */
    const origSubmit = formSvc.formSubmit?.bind(formSvc);
    formSvc.formSubmit = (id: string, onSubmit?: (values: AnyRecord, form: any) => void, ev?: Event) => {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      const ok = formSvc.validate(id);
      if (!ok) return;
      origSubmit?.(id, onSubmit, ev);
    };

    // Expose helpers
    formSvc.validators = validators;
    formSvc.isValid = (id: string) => ensureState(id).valid.value;
    formSvc.isDirty = (id: string) => ensureState(id).dirty.value;
  }
});
