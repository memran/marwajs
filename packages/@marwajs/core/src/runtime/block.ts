export interface Block<T = any> {
  /** The root DOM node for this block; used for moving/reordering. */
  el: Node;
  /** Insert the block under parent before anchor (or append). */
  mount(parent: Node, anchor?: Node | null): void;
  /** Optional update with new item/view + index. */
  patch?(value: T, index: number): void;
  /** Destroy resources (effects, listeners) and remove DOM if needed. */
  destroy(): void;
}
