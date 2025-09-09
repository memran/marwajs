export type Ctx = Record<string, any>;

let currentCtx: Ctx | null = null;

export function setCurrentCtx(ctx: Ctx | null) {
  currentCtx = ctx;
  (globalThis as any).__marwaCurrentCtx = ctx; // optional global fallback
}

export function getCurrentCtx(): Ctx {
  if (!currentCtx) {
    const g = (globalThis as any).__marwaCurrentCtx;
    if (g) return g;
    throw new Error('Marwa: no current component context. Call useModel inside setup().');
  }
  return currentCtx;
}
