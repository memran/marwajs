# MarwaJS

Tiny, fast front-end framework with signals, zero-config SFCs, built-in router, DI, and store.

## Packages

- `@marwajs/core` – core runtime, router, SFC plugin, devtools (dev-only)

## Quickstart

```bash
npm i @marwajs/core

```

## Vite config:

```bash
//playground/vite.config.ts
import { defineConfig } from 'vite';
import { MarwaSFC } from '@marwajs/core';

// IMPORTANT: set base to your repo name for GitHub Pages
const base = process.env.GITHUB_REPOSITORY?.split('/')[1] ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/` : '/';

export default defineConfig({
  root: __dirname,
  base,
  plugins: [MarwaSFC()],
  server: { port: 5173 }
});

```

# MarwaJS

✨ Tiny, fast framework with signals, SFCs, router, DI, and stores.

---

**Made with ❤️ using MarwaJS**
