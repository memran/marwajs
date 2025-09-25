import type { ComponentIR, Binding } from "./ir.js";

// Keep this minimal; we’ll add selectively based on bindings
const BASE_IMPORTS = new Set(["defineComponent"]);

export function generateComponent(
  ir: ComponentIR & { imports?: string[]; prelude?: string[] }
) {
  const used = new Set<string>(BASE_IMPORTS);

  // Always import Dom namespace (compiler targets it)
  used.add("Dom");

  // 1) Add extras requested explicitly (e.g., bindIf from :if compiler)
  for (const extra of ir.imports ?? []) used.add(extra);

  // 2) Collect imports by binding usage (text/style/model/event etc.)
  for (const b of ir.bindings) {
    collectRuntimeForBinding(b, used);
    if (b.kind === "event" && /\bwithModifiers\s*\(/.test(b.handler)) {
      used.add("withModifiers");
    }
  }

  // 3) Scan free-form code sections (create/mount/destroy/prelude) for helpers
  //    This captures helpers used by inline block factories (e.g., bindIf, bindText inside :if branches).
  const blob = [
    joinLines(ir.create),
    joinLines(ir.mount),
    joinLines(ir.destroy ?? []),
    joinLines(ir.prelude),
  ].join("\n");

  const maybe = (name: string) => {
    if (new RegExp(`\\b${name}\\s*\\(`).test(blob)) used.add(name);
  };

  // Helper names we might emit outside of ir.bindings
  [
    "bindIf",
    "bindFor",
    "bindSwitch",
    "bindText",
    "bindHTML",
    "bindShow",
    "bindClass",
    "bindStyle",
    "bindModel",
    "bindAttr",
    "onEvent",
    "withModifiers",
  ].forEach(maybe);

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
    case "attr":
      used.add("bindAttr");
      break;
    case "event":
      used.add("onEvent");
      break;
  }
  if (b.kind === "event" && /\bwithModifiers\s*\(/.test(b.handler)) {
    used.add("withModifiers");
  }
  used.add("Dom");
  used.add("defineComponent");
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
    case "attr":
      return `__stops.push(bindAttr(${b.target}, ${JSON.stringify(
        b.name
      )}, () => (${b.expr})));`;
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
