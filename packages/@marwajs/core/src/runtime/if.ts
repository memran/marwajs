import { effect, stop } from "../reactivity/effect";
import * as Dom from "./dom";
import type { Block } from "./block";

/**
 * Conditional mount/destroy with a stable [start, end) region.
 * Always inserts block before `end` so DOM order is stable.
 */
export function bindIf(
  parent: Node,
  get: () => boolean,
  makeThen: () => Block,
  makeElse?: () => Block,
  slot?: Node
): () => void {
  const start = Dom.createAnchor("if-start");
  const end = Dom.createAnchor("if-end");

  if (slot) {
    Dom.insert(start, parent, slot as any);
    Dom.insert(end, parent, slot as any);
    Dom.remove(slot as any);
  } else {
    Dom.insert(start, parent, null);
    Dom.insert(end, parent, null);
  }

  let cur: Block | null = null;
  let curIsThen = false;

  function mountBlock(b: Block) {
    // Block must honor provided anchor; we always place before `end`.
    b.mount(parent, end);
    cur = b;
  }

  function clear() {
    if (cur) {
      cur.destroy();
      cur = null;
    }
    let node = start.nextSibling;
    while (node && node !== end) {
      const next = node.nextSibling;
      Dom.remove(node);
      node = next;
    }
  }

  const runner = effect(() => {
    const on = !!get();

    if (on) {
      if (!cur || !curIsThen) {
        clear();
        mountBlock(makeThen());
        curIsThen = true;
      } else {
        // optional fast-path update
        cur.patch?.(undefined as any, 0);
      }
    } else {
      if (!makeElse) {
        clear();
        curIsThen = false;
        return;
      }
      if (!cur || curIsThen) {
        clear();
        mountBlock(makeElse());
        curIsThen = false;
      } else {
        cur.patch?.(undefined as any, 0);
      }
    }
  });

  return () => {
    stop(runner);
    clear();
    Dom.remove(start);
    Dom.remove(end);
  };
}
