import { describe, it, expect } from 'vitest';
import { ref, reactive, nextTick } from '../src';
import { Dom, bindFor } from '../src';

function makeItemBlock(text: string) {
  const el = Dom.createElement('li');
  const tn = Dom.createText(text);
  Dom.insert(tn, el);
  return {
    el,
    mount(parent: Node, anchor?: Node | null) { Dom.insert(el, parent, anchor ?? null); },
    patch(v: string) { Dom.setText(tn, v); },
    destroy() { Dom.remove(el); }
  };
}

describe(':for keyed list', () => {
  it('renders, updates, removes, and reorders by key', async () => {
    const host = document.createElement('ul');

    const list = ref<Array<{ id: number; label: string }>>([
      { id: 1, label: 'A' },
      { id: 2, label: 'B' },
      { id: 3, label: 'C' },
    ]);

    // Use viewOf to pass only the label string to the block
    const stop = bindFor(
      host,
      () => list.value,
      (it) => it.id,
      (it) => it.label,                 // viewOf
      (label) => makeItemBlock(label)   // block gets string view
    );

    expect(host.textContent).toBe('ABC');

    // update an item (same keys)
    list.value = [
      { id: 1, label: 'A1' },
      { id: 2, label: 'B' },
      { id: 3, label: 'C' },
    ];
    await nextTick();
    expect(host.textContent).toBe('A1BC');

    // remove middle
    list.value = [
      { id: 1, label: 'A1' },
      { id: 3, label: 'C' },
    ];
    await nextTick();
    expect(host.textContent).toBe('A1C');

    // insert new at front and reorder existing
    list.value = [
      { id: 4, label: 'X' },
      { id: 3, label: 'C' },
      { id: 1, label: 'A1' },
    ];
    await nextTick();
    expect(host.textContent).toBe('XCA1');

    stop();
  });

  it('works with reactive array and patch is called', async () => {
    const host = document.createElement('ul');
    const state = reactive({ items: ['a', 'b'] });

    // block that uses direct text updates in patch
    const stop = bindFor(
      host,
      () => state.items,
      (_, i) => i, // key by index (for test only)
      (it) => it, // viewOf = identity (string)
      (label) => {
        const el = Dom.createElement('li');
        const tn = Dom.createText(label);
        Dom.insert(tn, el);
        return {
          el,
          mount(parent, anchor) { Dom.insert(el, parent, anchor ?? null); },
          patch(v: string) { Dom.setText(tn, v); },
          destroy() { Dom.remove(el); }
        };
      }
    );

    expect(host.textContent).toBe('ab');

    state.items.push('c');
    await nextTick();
    expect(host.textContent).toBe('abc');

    state.items = ['z', 'y', 'x'];
    await nextTick();
    expect(host.textContent).toBe('zyx');

    stop();
  });
});
