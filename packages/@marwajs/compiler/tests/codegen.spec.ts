import { describe, it, expect } from "vitest";
import { generateComponent } from "../src/codegen";
import helloIR from "../src/examples/hello.ir";
import { compileSFC } from "../src/sfc/compileSFC";
import { createApp, nextTick } from "@marwajs/core";

// Evaluate generated ESM by injecting @marwajs/core runtime.
// - Removes ALL `import { ... } from '@marwajs/core'` lines (global)
// - Destructures the union of imported names from the real runtime
// - Rewrites `export default` to `return`
async function evalCompiled(code: string) {
  const runtime = await import("@marwajs/core");

  // Collect injection statements
  const destructured: Array<{ orig: string; alias: string }> = [];
  const namespaces: string[] = [];

  // 1) Strip & capture namespace imports:  import * as Core from '@marwajs/core'
  code = code.replace(
    /import\s*\*\s*as\s*([A-Za-z$_][\w$]*)\s*from\s*['"]@marwajs\/core['"]\s*;?/g,
    (_, ns) => {
      namespaces.push(ns);
      return "";
    }
  );

  // 2) Strip & capture named (possibly aliased) imports:
  //    import { a, b as c } from '@marwajs/core'
  code = code.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]@marwajs\/core['"]\s*;?/g,
    (_, group) => {
      group
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
        .forEach((entry: string) => {
          // entry: "name" OR "name as alias"
          const m = entry.match(
            /^([A-Za-z$_][\w$]*)(?:\s+as\s+([A-Za-z$_][\w$]*))?$/
          );
          if (m) {
            const orig = m[1];
            const alias = m[2] ?? orig;
            destructured.push({ orig, alias });
          }
        });
      return "";
    }
  );

  // 3) (Optional) Strip type-only imports from @marwajs/core (TS won’t run in eval)
  code = code.replace(
    /import\s+type\s*\{[^}]*\}\s*from\s*['"]@marwajs\/core['"]\s*;?/g,
    ""
  );

  // Build the header that injects from the real runtime
  const headerParts: string[] = [];
  if (destructured.length) {
    const pieces = destructured
      .map(({ orig, alias }) => (orig === alias ? orig : `${orig}: ${alias}`))
      .join(", ");
    headerParts.push(`const { ${pieces} } = runtime;`);
  }
  for (const ns of namespaces) {
    headerParts.push(`const ${ns} = runtime;`);
  }
  const header = headerParts.length ? headerParts.join("\n") + "\n" : "";

  // Replace "export default" with "return"
  const body = code.replace(/export\s+default\s+/, "return ");

  // Evaluate
  const factory = new Function("runtime", header + body);
  return factory(runtime);
}

it("handles :attr, key mods, and m-model modifiers", async () => {
  const sfc = `
<template>
  <div>
    <input :id="\`inp-\${n()}\`" m-model.number="n" />
    <p :text="\`n=\${n()}\`"></p>
    <button @keyup.enter.prevent="n.set(n() + 1)">+1 (enter)</button>
  </div>
</template>
<script lang="ts">
  import { signal } from '@marwajs/core'
  const n = signal(0)
</script>`;
  const { code } = compileSFC(sfc, "/virtual/Mods.marwa");
  const Comp = await evalCompiled(code);

  const host = document.createElement("div");
  const app = createApp(host);
  const inst = Comp({}, { app });
  inst.mount(host);
  await nextTick();

  const input = host.querySelector("input")!;
  const btn = host.querySelector("button")!;
  const para = host.querySelector("p")!;

  expect(input.id).toBe("inp-0");
  expect(para.textContent).toBe("n=0");

  // Simulate typing "41" (number modifier will coerce)
  (input as HTMLInputElement).value = "41";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();
  expect(para.textContent).toBe("n=41");

  // Keyup enter triggers +1 (with prevent)
  btn.dispatchEvent(
    new KeyboardEvent("keyup", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    })
  );
  await nextTick();
  expect(para.textContent).toBe("n=42");

  inst.destroy();
});

describe("codegen → ESM component", () => {
  it("compiles and runs the hello IR", async () => {
    const { code } = generateComponent(helloIR);
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(host);

    const inst = Comp({}, { app });
    inst.mount(host);
    await nextTick();

    expect(host.textContent).toContain("Count: 0");

    const btn = host.querySelector("button")!;
    btn.dispatchEvent(new Event("click", { bubbles: true }));
    await nextTick();
    expect(host.textContent).toContain("Count: 1");

    inst.destroy();
    host.remove(); // <-- and clean up
  });

  it("compiles and runs a .marwa SFC", async () => {
    const sfc = `
<template>
  <div>
    <h1>Count: {{ count() }}</h1>
    <button @click.prevent="count.set(count() + 1)">inc</button>
  </div>
</template>
<script lang="ts">
  import { signal } from '@marwajs/core'
  const count = signal(0)
</script>
<style scoped>
  h1 { color: red; }
</style>
`;
    const { code } = compileSFC(sfc, "/virtual/Hello.marwa");
    const Comp = await evalCompiled(code);

    const host = document.createElement("div");
    const app = createApp(host);

    const inst = Comp({}, { app });
    inst.mount(host);
    await nextTick();
    const styleTags = Array.from(document.head.querySelectorAll("style"));
    const hasScoped = styleTags.some((s) =>
      s.textContent?.includes("[data-mw-")
    );
    expect(hasScoped).toBe(true);

    expect(host.textContent).toContain("Count: 0");

    const btn = host.querySelector("button")!;
    //btn.dispatchEvent(new Event("click", { bubbles: true }));
    // btn.dispatchEvent(
    //   new MouseEvent("click", { bubbles: true, cancelable: true })
    // );

    btn.click();

    await nextTick();
    expect(host.textContent).toContain("Count: 1");

    inst.destroy();
  });
});
