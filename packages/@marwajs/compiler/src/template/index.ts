// Tiny barrel for template compiler internals.
// Re-exports are named to avoid changing any existing imports.
// No default export to keep tests and tree-shaking behavior identical.

export * from "./types.js";
export * from "./utils.js";
export * from "./event.js";
export * from "./attrs.js";
export * from "./clusters.js";
export * from "./emit.js";
export * from "./html.js";
export * from "./validation.js";
export { compileTemplateToIR } from "./compile.js";
