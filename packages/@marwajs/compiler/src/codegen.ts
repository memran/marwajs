import type { ComponentIR, Binding } from "./ir";

// Keep this minimal; we’ll add selectively based on bindings
const BASE_IMPORTS = new Set([
  "defineComponent",
  // dom + directives will be added as needed
]);

export function generateComponent(
  ir: ComponentIR & { imports?: string[]; prelude?: string[] }
) {
  const used = new Set<string>(BASE_IMPORTS);

  // Always import Dom namespace (compiler targets it)
  used.add("Dom");

  // Add extras requested explicitly
  for (const extra of ir.imports ?? []) used.add(extra);

  // Collect imports by binding usage
  for (const b of ir.bindings) {
    collectRuntimeForBinding(b, used);
    // If handler string uses withModifiers(...), make sure we import it
    if (b.kind === "event" && /\bwithModifiers\s*\(/.test(b.handler)) {
      used.add("withModifiers");
    }
  }

  // Build the import statement (Dom is a named export from core)
  const importList = Array.from(used).sort().join(", ");

  const code = `
import { ${importList} } from '@marwajs/core';

export default defineComponent((props, ctx) => {
  const __stops = [];

  ${joinLines(ir.prelude)}

  // === create ===
  ${joinLines(ir.create)}

  return {
    mount(target, anchor) {
      // === mount ===
      ${joinLines(ir.mount)}
      // === bindings ===
      ${ir.bindings.map((b) => emitBinding(b)).join("\n")}
    },
    destroy() {
      for (let i = __stops.length - 1; i >= 0; i--) {
        try { __stops[i](); } catch {}
      }
      __stops.length = 0;
      ${joinLines(ir.destroy ?? [])}
    }
  };
});

function __pushStop(fn) { __stops.push(fn); }
`.trim();

  return { code };
}

function collectRuntimeForBinding(b: Binding, used: Set<string>) {
  switch (b.kind) {
    case "text":
      used.add("bindText");
      break;
    case "html":
      used.add("bindHTML");
      break;
    case "show":
      used.add("bindShow");
      break;
    case "class":
      used.add("bindClass");
      break;
    case "style":
      used.add("bindStyle");
      break;
    case "model":
      used.add("bindModel");
      break;
    case "event":
      used.add("onEvent");
      break;
    // add others (e.g., 'for') as you implement them
  }
  // Dom is already included above
}

function emitBinding(b: Binding): string {
  switch (b.kind) {
    case "text":
      return `__stops.push(bindText(${b.target}, () => (${b.expr})));`;
    case "html":
      return `__stops.push(bindHTML(${b.target}, () => (${b.expr})));`;
    case "show":
      return `__stops.push(bindShow(${b.target}, () => !!(${b.expr})));`;
    case "class":
      return `__stops.push(bindClass(${b.target}, () => (${b.expr})));`;
    case "style":
      return `__stops.push(bindStyle(${b.target}, () => (${b.expr})));`;
    case "model": {
      const opts = b.options ? JSON.stringify(b.options) : "{}";
      const setter = b.set?.replace(/\$_/g, "v") ?? "v => {}";
      return `__stops.push(bindModel(ctx.app, ${b.target}, () => (${b.get}), (v) => (${setter}), ${opts}));`;
    }
    case "event":
      return `__stops.push(onEvent(ctx.app, ${b.target}, ${JSON.stringify(
        b.type
      )}, ${b.handler}));`;
  }
  return "";
}

function joinLines(lines?: string[]) {
  return (lines ?? []).join("\n");
}
