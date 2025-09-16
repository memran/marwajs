import { describe, it, expect } from "vitest";
import { compileSFC } from "../src/sfc/compileSFC";
import { createApp, nextTick } from "@marwajs/core";

// Robust ESM evaluator that inlines @marwajs/core imports.
async function evalCompiled(code: string) {
  const runtime = await import("@marwajs/core");

  // namespace imports: import * as Core from '@marwajs/core'
  const namespaces: string[] = [];
  code = code.replace(
    /import\s*\*\s*as\s*([A-Za-z$_][\w$]*)\s*from\s*['"]@marwajs\/core['"]\s*;?/g,
    (_, ns) => {
      namespaces.push(ns);
      return "";
    }
  );

  // named imports (possibly aliased)
  const destructured: Array<{ orig: string; alias: string }> = [];
  code = code.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]@marwajs\/core['"]\s*;?/g,
    (_, group) => {
      group
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((entry) => {
          const m = entry.match(
            /^([A-Za-z$_][\w$]*)(?:\s+as\s+([A-Za-z$_][\w$]*))?$/
          );
          if (m) destructured.push({ orig: m[1], alias: m[2] ?? m[1] });
        });
      return "";
    }
  );

  // type-only imports
  code = code.replace(
    /import\s+type\s*\{[^}]*\}\s*from\s*['"]@marwajs\/core['"]\s*;?/g,
    ""
  );

  const headerParts: string[] = [];
  if (destructured.length) {
    const pieces = destructured
      .map(({ orig, alias }) => (orig === alias ? orig : `${orig}: ${alias}`))
      .join(", ");
    headerParts.push(`const { ${pieces} } = runtime;`);
  }
  for (const ns of namespaces) headerParts.push(`const ${ns} = runtime;`);
  const header = headerParts.length ? headerParts.join("\n") + "\n" : "";

  const body = code.replace(/export\s+default\s+/, "return ");
  const factory = new Function("runtime", header + body);
  return factory(runtime);
}

describe("SFC basic", () => {
  it("compiles and runs a simple .marwa with mustache + @click.prevent", async () => {
    const sfc = `
<template>
  <div>
    <h1>Hello {{ who() }}</h1>
    <button @click.prevent="who.set('world')">go</button>
  </div>
</template>
<script lang="ts">
  import { signal } from '@marwajs/core'
  const who = signal('dev')
</script>
<style scoped>
  h1 { font-weight: bold; }
</style>`.trim();

    const { code } = compileSFC(sfc, "/virtual/Basic.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    const app = createApp(host);

    const inst = Comp({}, { app });
    inst.mount(host);
    await nextTick();

    expect(host.textContent).toContain("Hello dev");

    const btn = host.querySelector("button")!;
    btn.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );
    await nextTick();

    expect(host.textContent).toContain("Hello world");

    // style got injected once
    const hasScoped = Array.from(document.head.querySelectorAll("style")).some(
      (s) => s.textContent?.includes("[data-mw-")
    );
    expect(hasScoped).toBe(true);

    inst.destroy();
  });
});
