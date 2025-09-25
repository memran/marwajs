#!/usr/bin/env node
/**
 * create-marwajs.ts
 * Minimal, fast MarwaJS app scaffolder.
 * - No external deps (Node >= 18)
 * - ESM only
 * - Scaffolds: components/, pages/, layouts/, services/, public/
 * - Adds Vite + a tiny .marwa compiler script using @marwajs/compiler API
 * - Router wired with defineRoutes()/createRouter() from @marwajs/core
 * - Keep DX simple, bundle tiny
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const name = (args.find((a) => !a.startsWith("-")) ?? "marwa-app").trim();
const flags = new Set(args.filter((a) => a.startsWith("-")));
const pm = getFlagValue("--pm") ?? detectPm() ?? "npm";
const withGit = flags.has("--git") || flags.has("-g");
const skipInstall = flags.has("--no-install");
const appDir = join(process.cwd(), name);
main().catch((e) => {
    console.error(`\n✖ create-marwajs failed:\n`, e);
    process.exit(1);
});
async function main() {
    banner();
    // 1) Make directory
    await safeMkdir(appDir);
    // 2) Write files (template)
    await writeTree(appDir, TEMPLATE);
    // 3) Optional: git init
    if (withGit) {
        try {
            execSync("git init", { cwd: appDir, stdio: "ignore" });
            execSync("git add .", { cwd: appDir, stdio: "ignore" });
            execSync('git commit -m "chore: scaffold MarwaJS app"', {
                cwd: appDir,
                stdio: "ignore",
            });
            log("✓ Initialized git repository");
        }
        catch {
            warn("git not available? Skipping git init.");
        }
    }
    // 4) Install deps
    if (!skipInstall) {
        const cmd = pm === "pnpm"
            ? "pnpm i"
            : pm === "yarn"
                ? "yarn"
                : pm === "bun"
                    ? "bun install"
                    : "npm i";
        log(`Installing dependencies with ${pm}...`);
        try {
            execSync(cmd, { cwd: appDir, stdio: "inherit" });
        }
        catch (e) {
            warn("dependency install failed. You can install manually.");
        }
    }
    else {
        warn("skipping dependency install (--no-install).");
    }
    // 5) Done
    const rel = relative(process.cwd(), appDir) || ".";
    console.log(`\n🎉 Done! Now:\n`);
    console.log(`  cd ${rel}`);
    console.log(`  ${pmRun("dev")}   # start dev server (auto compiles .marwa)`);
    console.log(`  ${pmRun("build")} # build for production`);
    console.log(`  ${pmRun("preview")} # preview production build\n`);
}
/* ----------------------------- helpers ----------------------------- */
function pmRun(script) {
    switch (pm) {
        case "pnpm":
            return `pnpm run ${script}`;
        case "yarn":
            return `yarn ${script}`;
        case "bun":
            return `bun run ${script}`;
        default:
            return `npm run ${script}`;
    }
}
function detectPm() {
    const ua = process.env.npm_config_user_agent || "";
    if (ua.includes("pnpm"))
        return "pnpm";
    if (ua.includes("yarn"))
        return "yarn";
    if (ua.includes("bun"))
        return "bun";
    if (ua.includes("npm"))
        return "npm";
    return null;
}
function getFlagValue(k) {
    const i = args.indexOf(k);
    if (i !== -1 && args[i + 1])
        return args[i + 1];
    const eq = args.find((a) => a.startsWith(k + "="));
    return eq ? eq.split("=")[1] : null;
}
async function safeMkdir(dir) {
    if (existsSync(dir)) {
        const msg = `Directory "${dir}" already exists. Aborting.`;
        throw new Error(msg);
    }
    await mkdir(dir, { recursive: true });
}
async function writeTree(root, files) {
    const entries = Object.entries(files);
    for (const [p, content] of entries) {
        const full = join(root, p);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, content, "utf8");
    }
}
function banner() {
    console.log(`
┌────────────────────────────────────────────┐
│    Create MarwaJS App  —  tiny & fast     │
└────────────────────────────────────────────┘`);
}
function log(msg) {
    console.log(`• ${msg}`);
}
function warn(msg) {
    console.warn(`! ${msg}`);
}
/* ----------------------------- template ---------------------------- */
const TEMPLATE = {
    /* package + config */
    "package.json": pkgJson(),
    "tsconfig.json": tsconfig(),
    "vite.config.ts": viteConfig(),
    "marwa.config.ts": marwaConfig(),
    /* tooling: compile all .marwa → on build (also used by Vite plugin) */
    "tools/mw-compile.ts": mwCompile(),
    /* public + entry */
    "public/index.html": indexHtml(),
    "src/main.ts": mainTs(),
    "src/App.marwa": appMarwa(),
    /* router pages & components */
    "src/pages/Home.marwa": homePage(),
    "src/layouts/MainLayout.marwa": layout(),
    "src/components/HelloBox.marwa": helloBox(),
    "src/services/api.ts": apiTs(),
    /* type helpers (optional) */
    "src/env.d.ts": envDts(),
};
/* ------------------------- file generators ------------------------- */
function pkgJson() {
    return JSON.stringify({
        name,
        private: true,
        type: "module",
        scripts: {
            dev: "vite",
            build: "node --loader ts-node/esm tools/mw-compile.ts && vite build",
            preview: "vite preview",
            "compile:marwa": "node --loader ts-node/esm tools/mw-compile.ts",
        },
        devDependencies: {
            vite: "^5.4.0",
            typescript: "^5.6.2",
            "ts-node": "^10.9.2",
        },
        dependencies: {
            "@marwajs/core": "^0.1.0",
            "@marwajs/compiler": "^0.1.0",
        },
    }, null, 2);
}
function tsconfig() {
    return `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tools", "marwa.config.ts"]
}
`;
}
function viteConfig() {
    return `import { defineConfig } from "vite";
import marwa from "./marwa.config";

// A micro plugin to compile .marwa on-the-fly during dev.
function marwaPlugin() {
  return {
    name: "vite-plugin-marwa",
    enforce: "pre" as const,
    async load(id: string) {
      if (id.endsWith(".marwa")) {
        const { compileSFC } = await import("@marwajs/compiler");
        const src = await (await fetch("file://" + id)).text().catch(async () => {
          const { readFile } = await import("node:fs/promises");
          return readFile(id, "utf8");
        });
        const out = compileSFC(src, id).code;
        return out;
      }
    }
  };
}

export default defineConfig({
  server: { port: 5173, open: true },
  plugins: [marwaPlugin()],
  build: {
    target: "es2020",
    sourcemap: false
  },
  appType: "spa",
});
`;
}
function marwaConfig() {
    return `// marwa.config.ts
// Reserved for future compiler/runtime options.
// Keeping it here for discoverability & zero-config feel.
export default {
  // e.g., outDir for compiled artifacts if you want to persist them
};
`;
}
function mwCompile() {
    return `// tools/mw-compile.ts
// Tiny CLI to compile all .marwa files ahead-of-time for production builds.
import { globby } from "globby";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function main() {
  const { compileSFC } = await import("@marwajs/compiler");
  const files = await globby(["src/**/*.marwa"], { dot: false });

  for (const file of files) {
    const code = await readFile(file, "utf8");
    const out = compileSFC(code, file).code;
    // Emit side-by-side TypeScript module (e.g., Home.marwa.ts)
    const outFile = file + ".ts";
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, out, "utf8");
    console.log("compiled:", relative(process.cwd(), outFile));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// NOTE: globby is intentionally NOT added to deps to keep it lean.
// If you want zero extra deps, replace globby with a tiny recursive file walker.
// For convenience in DX, you may: npm i -D globby
`;
}
function indexHtml() {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover"
    />
    <title>MarwaJS App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;
}
function mainTs() {
    return `import { createApp, createRouter, defineRoutes, RouterView } from "@marwajs/core";
import App from "./App.marwa";

// File-based style routes (explicit for now)
const routes = defineRoutes([
  { path: "/", component: () => import("./pages/Home.marwa") },
  { path: "*", component: { // simple inline 404
      setup() { 
        return {
          mount(target: Node) {
            const el = document.createElement("div");
            el.textContent = "404 – Not Found";
            target.appendChild(el);
          }
        }
      }
    } 
  }
]);

const router = createRouter(routes);

const app = createApp(document.getElementById("app")!, {
  router
});

app.mount(App);
`;
}
function appMarwa() {
    return `<template>
  <main>
    <h1 :text="title"></h1>
    <!-- Built-in router mount point -->
    <RouterView/>
  </main>
</template>

<script setup lang="ts">
import { signal } from "@marwajs/core";

const title = signal("MarwaJS • tiny, fast, friendly");
</script>

<style scoped>
main {
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial;
  margin: 2rem auto;
  max-width: 720px;
  line-height: 1.6;
  padding: 0 1rem;
}
h1 { font-size: 1.8rem; margin-bottom: 1rem; }
a { text-decoration: none; }
</style>
`;
}
function homePage() {
    return `<template>
  <section>
    <p>Hello from <strong>Home</strong> page.</p>
    <HelloBox :message="msg"/>
    <div style="margin-top:1rem">
      <RouterLink to="/">Home</RouterLink>
      <!-- Add more links when you add pages -->
    </div>
  </section>
</template>

<script setup lang="ts">
import HelloBox from "../components/HelloBox.marwa";
import { signal } from "@marwajs/core";
const msg = signal("Welcome to MarwaJS 👋");
</script>

<style scoped>
section { border: 1px solid #e5e7eb; padding: 1rem; border-radius: 8px; }
</style>
`;
}
function layout() {
    return `<template>
  <div class="wrap">
    <header>
      <h2 :text="brand"></h2>
    </header>
    <slot/>
  </div>
</template>

<script setup lang="ts">
import { signal } from "@marwajs/core";
const brand = signal("Main Layout");
</script>

<style scoped>
.wrap { padding: 1rem; border: 1px dashed #ddd; }
header { margin-bottom: .75rem; }
</style>
`;
}
function helloBox() {
    return `<template>
  <div class="hello">
    <span>🔹 </span><span :text="message"></span>
  </div>
</template>

<script setup lang="ts">
export interface Props { message: string }
</script>

<style scoped>
.hello { padding: .5rem .75rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
</style>
`;
}
function apiTs() {
    return `// src/services/api.ts
// Keep services small and swappable
export async function get<T = unknown>(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, method: "GET" });
  if (!res.ok) throw new Error(\`GET \${url} -> \${res.status}\`);
  return (await res.json()) as T;
}
`;
}
function envDts() {
    return `/// <reference types="vite/client" />
declare module "*.marwa" {
  // The compiler emits a component factory (setup->hooks)
  const component: any;
  export default component;
}
`;
}
//# sourceMappingURL=index.js.map