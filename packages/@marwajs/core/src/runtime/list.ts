import * as Dom from "./dom";
import { effect, stop } from "../reactivity/effect";
import type { Block } from "./block";

/**
 * Keyed list binding (for `:for`).
 * Fast, tiny O(n) keyed reconciliation:
 *   - Reuse blocks by key, call patch(view, i)
 *   - Destroy blocks whose keys disappeared
 *   - Reinsert blocks in new order by appending in sequence (moves nodes)
 *
 * Overloads:
 *  - bindFor(parent, getItems, keyOf, makeBlock)                     // view = item (default)
 *  - bindFor(parent, getItems, keyOf, viewOf, makeBlock)             // view = viewOf(item, i)
 */
export function bindFor<T, K, V = T>(
  parent: Node,
  getItems: () => T[],
  keyOf: (item: T, index: number) => K,
  viewOf: (item: T, index: number) => V,
  makeBlock: (view: V, index: number) => Block<V>
): () => void;

export function bindFor<T, K>(
  parent: Node,
  getItems: () => T[],
  keyOf: (item: T, index: number) => K,
  makeBlock: (view: T, index: number) => Block<T>
): () => void;

export function bindFor<T, K, V = T>(
  parent: Node,
  getItems: () => T[],
  keyOf: (item: T, index: number) => K,
  arg4:
    | ((item: T, index: number) => V)
    | ((view: V, index: number) => Block<V>)
    | ((view: T, index: number) => Block<T>),
  arg5?: (view: V, index: number) => Block<V>
): () => void {
  const useViewMapper = typeof arg5 === "function";
  const viewOf = useViewMapper
    ? (arg4 as (item: T, index: number) => V)
    : (it: T) => it as unknown as V;
  const makeBlock = useViewMapper
    ? arg5!
    : (arg4 as (view: V, index: number) => Block<V>);

  type Rec = { key: K; block: Block<V> };
  let prev: Rec[] = [];

  const runner = effect(() => {
    const items = getItems() || [];
    const next: Rec[] = new Array(items.length);
    const oldMap = new Map<K, Rec>();
    for (const r of prev) oldMap.set(r.key, r);

    // 1) build next records, reusing blocks when key matches
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const key = keyOf(it, i);
      const view = viewOf(it, i);
      const rec = oldMap.get(key);
      if (rec) {
        rec.block.patch?.(view, i);
        next[i] = { key, block: rec.block };
        oldMap.delete(key);
      } else {
        const block = makeBlock(view, i);
        block.mount(parent, null); // append for now; reorder step will place correctly
        next[i] = { key, block };
      }
    }

    // 2) destroy blocks that disappeared
    for (const rec of oldMap.values()) {
      rec.block.destroy();
      if (rec.block.el.parentNode === parent) Dom.remove(rec.block.el);
    }

    // 3) reorder DOM to match "next" (append in sequence moves nodes)
    for (const rec of next) {
      Dom.insert(rec.block.el, parent, null);
    }

    prev = next;
  });

  return () => stop(runner);
}
