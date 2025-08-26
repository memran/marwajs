import { effect, isSignal } from './reactivity';

export function __eval_raw(expr: string, ctx: any) {
  try {
    // VERY small evaluator (safe context), avoid 'with' to prevent strict error
    return Function(...Object.keys(ctx), `return (${expr});`)(...Object.values(ctx));
  } catch (e) {
    console.warn('[Marwa] expr error:', expr, e);
    return undefined;
  }
}

export function bindElement(el: Element, ctx: any) {
  for (const a of Array.from(el.attributes)) {
    const n = a.name, v = a.value;

    // Events: @click="handler"
    if (n.startsWith('@')) {
      const ev = n.slice(1);
      (el as any).addEventListener(ev, (e: Event) => {
        const fn = __eval_raw(v, ctx);
        if (typeof fn === 'function') fn.call(ctx, e);
      });
      continue;
    }

    // Text: :text="expr"
    if (n === ':text') {
      const update = () => { (el as HTMLElement).textContent = String(__eval_raw(v, ctx) ?? ''); };
      effect(update); update(); continue;
    }

    // If: :if="expr"
    if (n === ':if') {
      const comment = document.createComment('marwa:if');
      const parent = el.parentElement;
      const original = el.cloneNode(true) as Element;
      const update = () => {
        const ok = !!__eval_raw(v, ctx);
        if (!parent) return;
        const has = Array.from(parent.childNodes).includes(el);
        if (ok && !has) parent.insertBefore(el, comment);
        if (!ok && has) parent.replaceChild(comment, el);
      };
      parent?.insertBefore(comment, el);
      effect(update); update(); continue;
    }

    // For: :for="item in list" or "(k,v) in obj"
    if (n === ':for') {
      const parent = el.parentElement!;
      const tpl = el.cloneNode(true) as Element;
      parent.removeChild(el);

      const render = () => {
        // Clear previous block (simple strategy)
        Array.from(parent.querySelectorAll('[data-m-for="' + (tpl as any).__id + '"]')).forEach(n => n.remove());
        const m = v.match(/^\s*(?:\(([^)]+)\)|([^\s]+))\s+in\s+(.+)\s*$/);
        if (!m) return;
        const vars = (m[1] || m[2]).split(',').map(s => s.trim());
        const src = __eval_raw(m[3], ctx);
        const id = (tpl as any).__id || ((tpl as any).__id = Math.random().toString(36).slice(2));

        const entries = Array.isArray(src) ? src.entries()
          : (src && typeof src === 'object') ? Object.entries(src)
          : [];

        for (const [k, val] of entries as any) {
          const node = tpl.cloneNode(true) as Element;
          (node as any).setAttribute('data-m-for', id);
          const local = Object.create(ctx);
          if (vars.length === 2) { local[vars[0]] = k; local[vars[1]] = val; }
          else { local[vars[0]] = val; }
          bindElement(node, local);
          // also walk children for nested custom tags (handled later by mountComponent)
          parent.appendChild(node);
        }
      };
      effect(render); render();
      continue;
    }

    // Attrs: :title="expr" or :class="expr"
    if (n.startsWith(':')) {
      const attr = n.slice(1);
      const update = () => {
        const val = __eval_raw(v, ctx);
        if (val == null || val === false) el.removeAttribute(attr);
        else el.setAttribute(attr, String(val));
      };
      effect(update); update(); continue;
    }

    // Plain attrs remain as-is
  }
}
