import type { ComponentIR, Binding } from "./ir";

const RUNTIME_IMPORTS = [
  // core
  "defineComponent",
  "effect",
  "stop",
  // dom & directives
  "Dom",
  "bindText",
  "bindHTML",
  "bindShow",
  "bindClass",
  "bindStyle",
  "bindModel",
  "onEvent",
  "withModifiers",
  "bindFor",
];

export function generateComponent(
  ir: ComponentIR & {
    /** optional extra runtime imports (e.g., 'signal') */
    imports?: string[];
    /** optional prelude lines emitted inside setup() before create/mount */
    prelude?: string[];
  }
): { code: string } {
  const used = new Set(RUNTIME_IMPORTS);
  for (const b of ir.bindings) {
    collectRuntimeForBinding(b, used);
  }
  for (const extra of ir.imports ?? []) used.add(extra);

  //   const importList = Array.from(used)
  //     .filter(x => x !== 'Dom')
  //     .sort()
  //     .join(', ');

  const importList = Array.from(used)
    .filter((x) => x !== "Dom")
    .sort()
    .join(", ");

  const code = `
import { ${importList}, Dom } from '@marwajs/core';
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
    case "event":
      used.add("onEvent");
      break;
    case "model":
      used.add("bindModel");
      break;
    case "for":
      used.add("bindFor");
      break; // future
  }
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
    case "event":
      return `__stops.push(onEvent(ctx.app, ${b.target}, ${JSON.stringify(
        b.type
      )}, ${b.handler}));`;
    case "model": {
      const opts = b.options ? JSON.stringify(b.options) : "{}";
      const setter = b.set?.replace(/\$_/g, "v") ?? "v => {}";
      return `__stops.push(bindModel(ctx.app, ${b.target}, () => (${b.get}), (v) => (${setter}), ${opts} ));`;
    }
    default:
      return `/* unknown binding */`;
  }
}

function joinLines(lines?: string[]) {
  return (lines ?? []).join("\n");
}
