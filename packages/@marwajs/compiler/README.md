# @marwajs/compiler

Ahead-of-time compiler for **MarwaJS**.  
Transforms `.marwa` Single File Components (SFCs) into plain ESM modules with no runtime parsing.

- 🚀 Compiles `<template>`, `<script lang="ts">`, `<style scoped>`
- 🧑‍💻 DX-first — auto-imports, scoped styles, file-based routing
- 🔒 Produces strongly typed `.d.ts`
- 🔧 Outputs IR → Codegen → Component

---

## Install

```sh
npm install -D @marwajs/compiler
```

## CLI

```sh
npx marwa compile src/**/*.marwa
```

## Quick Tutorial

Example .marwa

```sh
<template>
  <div>
    <p>Count: {{ count() }}</p>
    <button @click.prevent="inc()">Inc</button>
  </div>
</template>

<script lang="ts">
  import { signal } from "@marwajs/core";
  const count = signal(0);
  const inc = () => count.set(count() + 1);
</script>

<style scoped>
  div { padding: 1rem; }
</style>
```

Output (simplified)

```sh
import { signal, Dom, onEvent, withModifiers } from "@marwajs/core";

const count = signal(0);
const inc = () => count.set(count() + 1);

export default {
  mount(target) {
    const p = Dom.createElement("p");
    const btn = Dom.createElement("button");

    Dom.setText(p, `Count: ${count()}`);
    Dom.setText(btn, "Inc");

    onEvent(app, btn, "click", withModifiers(() => inc(), ["prevent"]));

    Dom.insert(p, target);
    Dom.insert(btn, target);
  }
};
```
