import { describe, it, expect } from "vitest";
import { compileSFC } from "../src/index";
import * as runtime from "@marwajs/core";
import { transformSync } from "@swc/core";

function loadComponentFromCode(esmWithTs: string, fallbackName: string) {
  const { code: esmJs } = transformSync(esmWithTs, {
    jsc: { target: "es2022", parser: { syntax: "typescript" } },
    module: { type: "es6" },
    filename: "inline.ts",
  });

  const withoutImports = esmJs
    .split("\n")
    .filter(
      (l) => !/^\s*import\s+.+from\s+['"]@marwajs\/core['"]\s*;?\s*$/.test(l)
    )
    .join("\n");

  let name = fallbackName;
  let code = withoutImports.replace(
    /export\s+default\s+function\s+([A-Za-z0-9_$]+)\s*\(/,
    (_m, n: string) => {
      name = n;
      return `function ${n}(`;
    }
  );

  const exported: string[] = [];
  code = code.replace(
    /export\s+const\s+([A-Za-z0-9_$]+)\s*=/g,
    (_m, n: string) => {
      exported.push(n);
      return `const ${n} =`;
    }
  );
  code = code.replace(
    /export\s+function\s+([A-Za-z0-9_$]+)\s*\(/g,
    (_m, n: string) => {
      exported.push(n);
      return `function ${n}(`;
    }
  );
  code = code.replace(/^\s*export\s*\{[^}]+\}\s*;?\s*$/gm, "");

  const prelude = `const { Dom, bindText, bindClass, bindStyle, bindShow, bindAttr, onEvent, signal, effect, stop } = runtime;`;
  let expose = "";
  if (exported.length) {
    expose += `\nif (!globalThis["__m"]) globalThis["__m"] = Object.create(null);\n`;
    expose +=
      exported.map((n) => `globalThis["__m"]["${n}"] = ${n};`).join("\n") +
      "\n";
  }
  const epilogue = `\nreturn ${name};`;

  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "runtime",
    `${prelude}\n${code}\n${expose}${epilogue}`
  );
  return fn(runtime) as (
    props: any,
    ctx: any
  ) => { mount(t: Node, a?: Node | null): void; destroy(): void };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const host = () => {
  const h = document.createElement("div");
  document.body.appendChild(h);
  return h;
};

describe("m-if / m-else-if / m-else", () => {
  it("toggles branches", async () => {
    const sfc = `<template>
    <div id="wrap">
      <p m-if="flag()">A</p>
      <p m-else-if="other()">B</p>
      <p m-else>C</p>
    </div>
  </template>
  <script lang="ts">
   const flag = signal(false);
   const other = signal(false);
  </script>`;
    const { code } = compileSFC(sfc, "IfTest.marwa");
    const Cmp = loadComponentFromCode(code, "IfTest");
    const h = host();
    const i = Cmp({}, { app: {} });
    i.mount(h, null);
    expect(h.textContent?.replace(/\s+/g, " ").trim()).toContain("C");
    (globalThis as any).__m.flag.set(true);
    await tick();
    expect(h.textContent?.replace(/\s+/g, " ").trim()).toContain("A");
    (globalThis as any).__m.flag.set(false);
    (globalThis as any).__m.other.set(true);
    await tick();
    expect(h.textContent?.replace(/\s+/g, " ").trim()).toContain("B");
    i.destroy();
  });
});

describe("m-switch / m-case / m-default", () => {
  it("renders matching case and updates", async () => {
    const sfc = `<template>
    <div id="wrap" m-switch="kind()">
      <span m-case="'x'">X</span>
      <span m-case="'y'">Y</span>
      <span m-default>DEF</span>
    </div>
  </template>
  <script lang="ts">
  export const kind = signal("y");
  </script>`;
    const { code } = compileSFC(sfc, "SwTest.marwa");
    const C = loadComponentFromCode(code, "SwTest");
    const h = host();
    const i = C({}, { app: {} });
    i.mount(h, null);
    expect(h.textContent?.replace(/\s+/g, " ").trim()).toBe("Y");
    (globalThis as any).__m.kind.set("x");
    await tick();
    expect(h.textContent?.replace(/\s+/g, " ").trim()).toBe("X");
    (globalThis as any).__m.kind.set("z");
    await tick();
    expect(h.textContent?.replace(/\s+/g, " ").trim()).toBe("DEF");
    i.destroy();
  });
});
