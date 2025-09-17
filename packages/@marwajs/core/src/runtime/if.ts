import { effect, stop } from "../reactivity/effect";
import * as Dom from "./dom";
import type { Block } from "./list";

/**
 * Conditional mount/destroy. Creates a stable region delimited by two anchors.
 * The factory returns a Block with { el, mount(parent, anchor), patch?(), destroy() }.
 */
export function bindIf(
  parent: Node,
  get: () => boolean,
  makeThen: () => Block,
  makeElse?: () => Block
): () => void {
  const start = Dom.createAnchor("if-start");
  const end = Dom.createAnchor("if-end");
  Dom.insert(start, parent, null);
  Dom.insert(end, parent, null);

  let cur: Block | null = null;
  let curIsThen = false;

  function mountBlock(b: Block) {
    // Always insert before the `end` anchor so ordering is stable
    b.mount(parent, end);
    cur = b;
  }

  function clear() {
    if (cur) {
      cur.destroy();
      // ensure node removed if destroy didn't
      if (cur.el.parentNode === parent) Dom.remove(cur.el);
      cur = null;
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
