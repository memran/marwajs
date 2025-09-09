import { Ref, effect } from './reactivity';

export type DirContext = { el: HTMLElement; ctx: any; emit: (e:string,...a:any[])=>void };
export type Directive = (value: any, d: DirContext) => void;

export const dText: Directive = (value, { el }) => {
  if (isRef(value)) effect(()=> el.textContent = String(value.value));
  else el.textContent = String(value ?? '');
};

export const dHtml: Directive = (value, { el }) => {
  el.innerHTML = sanitizeHTML(isRef(value) ? value.value : value);
};

export const dShow: Directive = (value, { el }) => {
  const apply = (v:any)=> (el as HTMLElement).style.display = v ? '' : 'none';
  if (isRef(value)) effect(()=> apply(value.value)); else apply(value);
};

export const dModel: Directive = (value, { el, emit }) => {
  const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (isRef(value)) {
    effect(()=> input.value = value.value ?? '');
    input.addEventListener('input', () => { (value as Ref<any>).value = (input as any).value; emit?.('update:model', (input as any).value); });
  }
};

export const dClass: Directive = (value, { el }) => {
  const apply = (v:any)=> {
    if (typeof v === 'string') { el.className = v; return; }
    if (v && typeof v === 'object') {
      for (const [k,on] of Object.entries(v)) (el as HTMLElement).classList.toggle(k, !!on);
    }
  };
  if (isRef(value)) effect(()=> apply(value.value)); else apply(value);
};

export const dStyle: Directive = (value, { el }) => {
  const apply = (v:any)=> { if (v && typeof v === 'object') Object.assign((el as HTMLElement).style, v); };
  if (isRef(value)) effect(()=> apply(value.value)); else apply(value);
};

export function isRef(x:any): x is Ref<any> { return x && typeof x === 'object' && 'value' in x; }
export function sanitizeHTML(s:any){ return String(s ?? ''); } // extend later (CSP, policy)
