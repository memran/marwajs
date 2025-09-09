import { getCurrentCtx } from './instance';
import { ref } from './reactivity';

/**
 * useModel:
 * - If parent passed a ref (props[name] has .value), we proxy it (so child can do count.value++).
 * - If parent passed a plain value, we wrap it into an internal ref.
 * - Writes always emit('update:<name>', v) so parent two-way binding works.
 * - Prints as a primitive so {{ count }} works without .value, AND remains reactive because
 *   toString/valueOf/Primitive read through the underlying ref.value.
 */
export function useModel<T = any>(name = 'model') {
  const ctx = getCurrentCtx();
  const props = ctx.props ?? {};
  const emit  = ctx.emit ?? (() => {});

  const src = props[name];
  const hasRefShape = src && typeof src === 'object' && 'value' in src;

  // Use parent's ref if available; otherwise make an internal one seeded with parent's value.
  const base: { value: T } = hasRefShape ? (src as any) : ref<T>(src);

  const proxy = new Proxy(base as any, {
    get(target, key, receiver) {
      if (key === 'value') return target.value; // reactive read
      if (key === 'toString') return () => String(target.value);
      if (key === 'valueOf')  return () => target.value;
      // Make {{ count }} reactive via primitive conversion
      if (key === Symbol.toPrimitive) {
        return (hint: 'default' | 'string' | 'number') => {
          const v = target.value;
          return hint === 'number' ? (typeof v === 'number' ? v : Number(v)) : v;
        };
      }
      return Reflect.get(target, key, receiver);
    },
    set(target, key, val, receiver) {
      if (key === 'value') {
        target.value = val;            // update (parent's ref or internal ref)
        try { emit(`update:${name}`, val); } catch {}
        return true;
      }
      return Reflect.set(target, key, val, receiver);
    }
  });

  return proxy as { value: T };
}
