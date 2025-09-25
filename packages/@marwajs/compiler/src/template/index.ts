// Tiny barrel for template compiler internals.
// Re-exports are named to avoid changing any existing imports.
// No default export to keep tests and tree-shaking behavior identical.

export * from "./types";
export * from "./utils";
export * from "./event";
export * from "./attrs";
export * from "./clusters";
export * from "./emit";
export * from "./html";
export * from "./validation";
export { compileTemplateToIR } from "./compile";
