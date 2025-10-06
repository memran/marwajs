import { coreRuntime } from "./mockCore";
import { transformSync } from "@swc/core";

/**
 * Rewrite generated code:
 *  - import { ... } from '@marwajs/core'  ->  const { ... } = __runtime;
 *  - export default function Name(...)    ->  function Name(...); __exports.default = Name;
 * Transpile TS -> JS (SWC), then execute with injected runtime/exports.
 */
export function loadComponentFromCode(code: string) {
  // 1) Replace the runtime import
  const importRe = /import\s*\{([^}]+)\}\s*from\s*['"]@marwajs\/core['"];?/s;
  let transformed = code;
  const importMatch = transformed.match(importRe);
  if (importMatch) {
    const names = importMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", ");
    transformed = transformed.replace(
      importRe,
      `const { ${names} } = __runtime;`
    );
  }

  // 2) Replace export default function
  const exportFnRe = /export\s+default\s+function\s+([A-Za-z0-9_$]+)\s*\(/;
  const m = transformed.match(exportFnRe);
  if (!m)
    throw new Error(
      "Loader: could not find `export default function <Name>(...)` in generated code."
    );
  const compName = m[1];
  transformed = transformed.replace(exportFnRe, `function ${compName}(`);
  transformed += `\n\n__exports.default = ${compName};\n`;

  // 3) Transpile TS -> JS (no top-level return anymore)
  const { code: js } = transformSync(transformed, {
    jsc: { target: "es2022", parser: { syntax: "typescript" } },
    module: { type: "es6" }, // fine; no top-level return
    filename: "generated-component.ts",
  });

  // 4) Execute script with injected runtime & exports
  // eslint-disable-next-line no-new-func
  const factory = new Function("__runtime", "__exports", js);
  const out: any = {};
  factory(coreRuntime, out);
  const component = out.default;

  return component as (
    props?: any,
    ctx?: any
  ) => {
    mount(target: Node, anchor?: Node | null): void;
    patch?: Function;
    destroy(): void;
  };
}
