import type { App } from './app';

export type DevEvent =
  | { type: 'store:update'; token: string; prev: any; next: any }
  | { type: 'signal:set'; key: string; prev: any; next: any }
  | { type: 'component:mount'; name: string; props: any }
  | { type: 'component:unmount'; name: string }
  | { type: 'router:navigate'; from: string; to: string };

const devListeners = new Set<(e: DevEvent) => void>();

export function devEmit(e: DevEvent) {
  if (import.meta.env.PROD) return;
  devListeners.forEach(fn => { try { fn(e); } catch {} });
}

export function onDevEvent(fn: (e: DevEvent) => void) {
  devListeners.add(fn);
  return () => devListeners.delete(fn);
}

export function PulseDevtools() {  // exported as MarwaDevtools in index.ts
  return (_app: App) => {
    if (import.meta.env.PROD) return;

    const panel = document.createElement('div');
    panel.style.cssText = `
      position:fixed;bottom:0;right:0;width:340px;height:200px;
      background:#111;color:#0f0;font:12px monospace;overflow:auto;
      border:1px solid #0f0;z-index:99999;padding:4px;display:none;`;
    document.body.appendChild(panel);

    let visible = false;
    function toggle(){ visible = !visible; panel.style.display = visible ? 'block' : 'none'; }

    window.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') { e.preventDefault(); toggle(); }
    });

    onDevEvent(e => {
      if (!visible) return;
      const line = document.createElement('div');
      line.textContent = `[${e.type}] ${JSON.stringify(e)}`;
      panel.appendChild(line);
      panel.scrollTop = panel.scrollHeight;
    });

    (window as any).__MARWA_DEVTOOLS__ = { onDevEvent, toggle };
  };
}
