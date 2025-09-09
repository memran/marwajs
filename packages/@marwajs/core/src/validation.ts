export type FieldRule<T = any> = (value: T) => string | null | Promise<string | null>;
export type FieldRules = Record<string, FieldRule | FieldRule[]>;
export type ValidationResult = { valid: boolean; errors: Record<string, string[]> };

export async function validate(data: Record<string, any>, rules: FieldRules): Promise<ValidationResult> {
  const errors: Record<string, string[]> = {};
  for (const [k, r] of Object.entries(rules)) {
    const arr = Array.isArray(r) ? r : [r];
    for (const rule of arr) {
      const msg = await rule(data[k]);
      if (msg) (errors[k] ||= []).push(msg);
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

// built-ins
export const required: FieldRule = v => (v === null || v === undefined || v === '' ? 'Required' : null);
export const minLen = (n: number): FieldRule => v => (typeof v === 'string' && v.length < n ? `Min length ${n}` : null);
export const email: FieldRule = v => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v ?? '') ? null : 'Invalid email');

// optional Zod integration
export type ZodSchema = { safeParse: (d: any) => { success: boolean; error?: { errors: Array<{ path: (string|number)[], message: string }> } } };
export function zod(schema: ZodSchema): (data: any) => ValidationResult {
  return (data) => {
    const r = schema.safeParse(data);
    if (r.success) return { valid: true, errors: {} };
    const out: Record<string, string[]> = {};
    for (const e of r.error?.errors || []) {
      const key = String(e.path?.[0] ?? '_');
      (out[key] ||= []).push(e.message);
    }
    return { valid: false, errors: out };
  };
}
