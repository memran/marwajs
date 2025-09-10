#!/usr/bin/env node
const pkg = { name: "create-marwa", version: "0.0.1" };
const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-v")) {
    console.log(`${pkg.name} ${pkg.version}`);
    process.exit(0);
}
if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    console.log(`create-marwa

Usage:
  create-marwa <project-name>

Flags:
  -h, --help       Show help
  -v, --version    Show version
`);
    process.exit(0);
}
const name = args[0];
console.log(`[create-marwa] Scaffolding project: ${name}`);
export {};
// TODO(Phase 6): copy template files
//# sourceMappingURL=index.js.map