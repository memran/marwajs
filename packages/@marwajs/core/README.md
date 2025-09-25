# @marwajs/core

Tiny, fast, DX-first runtime for **MarwaJS** built entirely on **signals**.

- 🔥 Zero runtime parsing — compiler emits plain TS/JS
- 🎯 Signals-based reactivity (`signal`, `computed`, `effect`)
- 🧩 Components (`defineComponent`, `onMount`, `provide/inject`)
- 🛠 Directives (`:text`, `:class`, `:style`, `:show`, `m-model`, `@click.stop.prevent`)
- 🌐 Router + DI + Stores
- ⚡ Super small, tree-shakeable

---

## Install

```sh
npm install @marwajs/core
```

# Quick Start

```sh
import { signal, effect, Dom, createApp } from "@marwajs/core";

// define state
const count = signal(0);

// watch changes
effect(() => console.log("count:", count()));

// build UI
const host = document.getElementById("app")!;
const app = createApp(host);

const btn = Dom.createElement("button");
Dom.setText(btn, "inc");
app.on("click", btn, () => count.set(count() + 1));
Dom.insert(btn, host);
```

## Tutorials

### 1. Counter Component

```sh
import { defineComponent, signal, Dom } from "@marwajs/core";

export const Counter = defineComponent(() => {
  const count = signal(0);

  return {
    mount(target) {
      const btn = Dom.createElement("button");
      const p = Dom.createElement("p");

      Dom.setText(p, `Count: ${count()}`);
      Dom.insert(p, target);
      Dom.insert(btn, target);

      btn.textContent = "Inc";
      btn.onclick = () => count.set(count() + 1);

      // reactive binding
      effect(() => {
        Dom.setText(p, `Count: ${count()}`);
      });
    },
  };
});

```

### 2. Provide / Inject

```sh
import { defineComponent, provide, inject } from "@marwajs/core";

const Parent = defineComponent(() => {
  provide("theme", "dark");
  return { mount(t) { /* mount child */ } };
});

const Child = defineComponent(() => {
  const theme = inject("theme", "light");
  return { mount(t) { console.log("theme:", theme); } };
});

```

# LICENSE

MIT License
