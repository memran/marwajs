import { effect, stop } from "../reactivity/effect";
import * as Dom from "./dom";
import type { Block } from "./list";

export type SwitchBranch = {
  when: () => any; // truthy = match
  factory: () => Block; // creates the branch block
};

/**
 * Reactive multi-branch switch:
 *   - Evaluates branches in order and mounts the first truthy branch.
 *   - Falls back to elseFactory when none match (optional).
 *   - Keeps a stable [start, end) region; always inserts before `end`.
 *   - Returns a disposer to tear everything down.
 */
export function bindSwitch(
  parent: Node,
  branches: SwitchBranch[],
  elseFactory?: () => Block,
  slot?: Node
): () => void {
  const start = Dom.createAnchor("switch-start");
  const end = Dom.createAnchor("switch-end");

  // Place anchors. If a slot is provided (e.g., compiler used a temp anchor),
  // insert at the slot position and remove the slot.
  if (slot) {
    Dom.insert(start, parent, slot as any);
    Dom.insert(end, parent, slot as any);
    Dom.remove(slot as any);
  } else {
    Dom.insert(start, parent, null);
    Dom.insert(end, parent, null);
  }

  let cur: Block | null = null;
  let curIndex = -2; // -2 = nothing mounted yet; -1 = else; >=0 = branch index

  function mountBlock(b: Block) {
    // Blocks must honor `end` anchor; we always insert before `end`.
    b.mount(parent, end);
    cur = b;
  }

  function clear() {
    if (cur) {
      cur.destroy();
      cur = null;
    }
    // Remove any stray nodes between start and end to keep region clean.
    let node = start.nextSibling;
    while (node && node !== end) {
      const next = node.nextSibling;
      Dom.remove(node);
      node = next;
    }
  }

  const runner = effect(() => {
    // Find first matching branch
    let match = -1;
    for (let i = 0; i < branches.length; i++) {
      if (branches[i].when()) {
        match = i;
        break;
      }
    }

    if (match >= 0) {
      // Mount/update matched branch
      if (curIndex !== match) {
        clear();
        mountBlock(branches[match].factory());
        curIndex = match;
      } else {
        // Optional fast-path patch if the active block supports it
        cur?.patch?.(undefined as any, 0);
      }
    } else {
      // No branch matched → else branch (if provided) or clear
      if (!elseFactory) {
        clear();
        curIndex = -2; // nothing mounted
        return;
      }
      if (curIndex !== -1) {
        clear();
        mountBlock(elseFactory());
        curIndex = -1;
      } else {
        cur?.patch?.(undefined as any, 0);
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
