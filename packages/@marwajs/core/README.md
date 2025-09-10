# @marwajs/core (Phase 1)

Tiny reactivity core for MarwaJS:

- `ref`, `reactive`, `computed`, `effect`, `stop`, `untrack`
- Batched microtask scheduler
- No runtime template parsing (compiler will target this)

## Quick start

```ts
import { ref, reactive, computed, effect, stop, nextTick } from "@marwajs/core";

const count = ref(0);
const state = reactive({ a: 1, b: 2 });
const sum = computed(() => count.value + state.a);

const runner = effect(() => {
  console.log("sum =", sum.value);
});

count.value++;
state.a++;

await nextTick();
// later
stop(runner);
```
