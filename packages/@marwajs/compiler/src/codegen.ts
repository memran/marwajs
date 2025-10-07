// src/codegen.ts
import type { ComponentIR, Binding } from "./ir";
import { CompilerError } from "./errors";

/** Generate a runtime component factory from IR. */
export function generateComponent(ir: ComponentIR): string {
  if (!ir) throw new CompilerError("IR must not be null or undefined.");

  const imports = ir.imports.length
    ? `import { ${ir.imports.join(", ")} } from '@marwajs/core';`
    : `import { Dom } from '@marwajs/core';`;

  const createLines = ir.create.join("\n  ");
  const mountLines = ir.mount.join("\n      ");
  const bindingLines = emitBindings(ir.bindings);

  return `
${imports}

export default function ${toSafeName(ir.name)}(props: any, ctx: any){
  const __stops: Array<() => void> = [];
  ${createLines}
  return {
    mount(target: Node, anchor?: Node | null){
      ${mountLines}
      ${bindingLines}
    },
    patch() {},
    destroy(){ for(let i=__stops.length-1;i>=0;i--){ try{__stops[i]();}catch{} } }
  };
}
`;
}

function toSafeName(name: string): string {
  if (!name) throw new CompilerError("Component name must not be empty.");
  return name.replace(/[^A-Za-z0-9_$]/g, "_");
}

function emitBindings(bindings: Binding[]): string {
  const lines: string[] = [];
  for (const b of bindings) {
    switch (b.kind) {
      case "text":
        lines.push(`__stops.push(bindText(${b.target}, ()=>(${b.expr})));`);
        break;
      case "class":
        lines.push(`__stops.push(bindClass(${b.target}, ()=>(${b.expr})));`);
        break;
      case "style":
        lines.push(`__stops.push(bindStyle(${b.target}, ()=>(${b.expr})));`);
        break;
      case "show":
        lines.push(`__stops.push(bindShow(${b.target}, ()=>!!(${b.expr})));`);
        break;
      case "attr":
        lines.push(
          `__stops.push(bindAttr(${b.target}, ${JSON.stringify(b.name)}, ()=>(${
            b.expr
          })));`
        );
        break;
      case "event":
        // IMPORTANT: wrap expression in a function so it's invoked on event, not at mount.
        lines.push(
          `__stops.push(onEvent((ctx as any).app, ${b.target}, ${JSON.stringify(
            b.type
          )}, (e)=>(${b.handler})));`
        );
        break;
      default:
        throw new CompilerError(`Unknown binding kind: ${(b as any).kind}`);
    }
  }
  return lines.join("\n      ");
}
