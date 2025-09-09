# MarwaJS

MarwaJS is a **tiny, fast frontend framework** with:

- Signals and reactive core
- Zero-config single-file components (`.marwa`)
- Built-in router
- Dependency injection and stores
- Simple, stable, and production-ready

> Designed for minimal bundle size and maximum developer experience.

---

## ✨ Features

- ⚡ **Tiny & Fast**: Core focuses on performance and small runtime.
- 📦 **Zero Config SFCs**: `.marwa` files support `<template>`, `<script setup>`, `<style scoped>`.
- 🔗 **Built-in Router**: File-based routes, layouts, and 404 handling out of the box.
- 🛠 **Signals & Stores**: Simple reactivity and global store system.
- 🔌 **Plugin System**: Extend with `app.use()`.
- 🚀 **DX First**: Compiler auto-injects imports, handles scoped styles, and optimizes builds.

---

## 📦 Installation

```bash
npm install @marwajs/core
npm install -D @marwajs/compiler
```

# Usage

## 1. Create a component

```bash
<!-- src/pages/Home.marwa -->
<template>
  <h1>Hello {{ name }}</h1>
  <input m-model="name" />
</template>

<script setup>
const name = ref('World')
</script>
```

## 2. Define App Shell

```bash
<!-- src/App.marwa -->
<template>
  <header>MarwaJS Demo</header>
  <RouterView />
</template>

```

## 3. Mount App

```bash
// src/main.ts
import { createApp } from '@marwajs/core'
import { routes } from './routes'

import App from './App.marwa'

createApp(App).useRouter(routes).mount('#app')
```

# CLI

Compile .marwa files:

```bash
npx marwa compile
```

# License

MIT © 2025 Mohammad Emran
