import { describe, it, expect } from "vitest";
import { compileSFC } from "../src/index";
import * as runtime from "@marwajs/core";
import { transformSync } from "@swc/core";

/** ESM (with TS) → JS string → IIFE loader injecting real @marwajs/core. */
function loadComponentFromCode(esmWithTs: string, fallbackName: string) {
  // 0) TS → JS (still ESM)
  const { code: esmJs } = transformSync(esmWithTs, {
    jsc: { target: "es2022", parser: { syntax: "typescript" } },
    module: { type: "es6" },
    filename: "inline-component.ts",
  });

  // 1) Strip runtime imports (we inject runtime below)
  const withoutImports = esmJs
    .split("\n")
    .filter(
      (line) =>
        !/^\s*import\s+.+from\s+['"]@marwajs\/core['"]\s*;?\s*$/.test(line)
    )
    .join("\n");

  // 2) Rewrite exports → locals; capture default export name
  let componentName = fallbackName;
  let code = withoutImports.replace(
    /export\s+default\s+function\s+([A-Za-z0-9_$]+)\s*\(/,
    (_m, name: string) => {
      componentName = name;
      return `function ${name}(`;
    }
  );

  const exportedNames: string[] = [];
  code = code.replace(
    /export\s+const\s+([A-Za-z0-9_$]+)\s*=/g,
    (_m, n: string) => {
      exportedNames.push(n);
      return `const ${n} =`;
    }
  );
  code = code.replace(
    /export\s+function\s+([A-Za-z0-9_$]+)\s*\(/g,
    (_m, n: string) => {
      exportedNames.push(n);
      return `function ${n}(`;
    }
  );
  code = code.replace(/^\s*export\s*\{[^}]+\}\s*;?\s*$/gm, "");

  // 3) Inject real runtime + expose named exports on globalThis["__m"]
  const prelude = `const {
  Dom,
  bindText,
  bindClass,
  bindStyle,
  bindShow,
  bindAttr,
  onEvent,
  signal,
  effect,
  stop
} = runtime;`;

  const ns = "__m";
  let expose = "";
  if (exportedNames.length > 0) {
    expose += `\nif (!globalThis["${ns}"]) globalThis["${ns}"] = Object.create(null);\n`;
    expose +=
      exportedNames
        .map((n) => `globalThis["${ns}"]["${n}"] = ${n};`)
        .join("\n") + "\n";
  }

  const epilogue = `\nreturn ${componentName};`;

  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "runtime",
    `${prelude}\n${code}\n${expose}${epilogue}`
  );
  return fn(runtime) as (
    props: any,
    ctx: any
  ) => {
    mount(target: Node, anchor?: Node | null): void;
    destroy(): void;
    patch?: (p?: any) => void;
  };
}

function mountHost(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("runtime reactivity (happy-dom + real @marwajs/core)", () => {
  it("updates text via signal + bindText when signal changes", async () => {
    const sfc = `<template>
  <div id="root"><span id="g">Hello {{ name() }}</span></div>
</template>
<script lang="ts">
export const name = signal("A");
</script>`;

    const { code } = compileSFC(sfc, "HelloName.marwa");
    const Component = loadComponentFromCode(code, "HelloName");

    const host = mountHost();
    const instance = Component({}, { app: {} });
    instance.mount(host, null);

    const span = host.querySelector<HTMLSpanElement>("#g")!;
    expect(span.textContent).toContain("Hello A");

    (globalThis as any).__m.name.set("B");
    await tick();
    expect(span.textContent).toContain("Hello B");

    instance.destroy();
  });

  it("reacts on m-class updates", async () => {
    const sfc = `<template>
  <div id="box" m-class="cls()"></div>
</template>
<script lang="ts">
export const cls = signal("a");
</script>`;

    const { code } = compileSFC(sfc, "BoxClass.marwa");
    const Component = loadComponentFromCode(code, "BoxClass");

    const host = mountHost();
    const instance = Component({}, { app: {} });
    instance.mount(host, null);

    const el = host.querySelector<HTMLDivElement>("#box")!;
    expect(el.className).toContain("a");

    (globalThis as any).__m.cls.set("b");
    await tick();
    expect(el.className).toContain("b");

    instance.destroy();
  });

  it("handles @click and increments a signal", async () => {
    const sfc = `<template>
  <button id="btn" @click="inc()">Count {{ count() }}</button>
</template>
<script lang="ts">
export const count = signal(0);
export function inc(){ count.set(count() + 1); }
</script>`;

    const { code } = compileSFC(sfc, "Counter.marwa");
    const Component = loadComponentFromCode(code, "Counter");

    const host = mountHost();
    const instance = Component({}, { app: {} });
    instance.mount(host, null);

    const btn = host.querySelector<HTMLButtonElement>("#btn")!;
    expect(btn.textContent).toContain("Count 0");

    btn.click();
    await tick();
    expect(btn.textContent).toContain("Count 1");

    btn.click();
    await tick();
    expect(btn.textContent).toContain("Count 2");

    instance.destroy();
  });

  it("binds dynamic attribute via m-* and reacts", async () => {
    const sfc = `<template>
  <button id="al" m-aria-label="label()"></button>
</template>
<script lang="ts">
export const label = signal("start");
</script>`;

    const { code } = compileSFC(sfc, "AriaLabel.marwa");
    const Component = loadComponentFromCode(code, "AriaLabel");

    const host = mountHost();
    const instance = Component({}, { app: {} });
    instance.mount(host, null);

    const btn = host.querySelector<HTMLButtonElement>("#al")!;
    expect(btn.getAttribute("aria-label")).toBe("start");

    (globalThis as any).__m.label.set("go");
    await tick();
    expect(btn.getAttribute("aria-label")).toBe("go");

    instance.destroy();
  });
});
