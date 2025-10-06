import type { ComponentIR, Binding } from "./ir";
import { CompilerError } from "./errors";

export function generateComponent(ir: ComponentIR): string {
  if (!ir) throw new CompilerError("IR must not be null or undefined.");

  const imports = ir.imports.length
    ? `import { ${ir.imports.join(", ")} } from '@marwajs/core';`
    : `import { Dom } from '@marwajs/core';`;

  const create = ir.create.join("\n  ");
  const mount = ir.mount.join("\n      ");
  const binds = emitBindings(ir.bindings);

  return `
${imports}

export default function ${safe(ir.name)}(props: any, ctx: any){
  const __stops: Array<() => void> = [];
  ${create}
  return {
    mount(target: Node, anchor?: Node | null){
      ${mount}
      ${binds}
    },
    patch() {},
    destroy(){ for(let i=__stops.length-1;i>=0;i--){ try{__stops[i]();}catch{} } }
  };
}
`;
}

function safe(n: string) {
  if (!n) throw new CompilerError("Component name must not be empty.");
  return n.replace(/[^A-Za-z0-9_$]/g, "_");
}

function emitBindings(bs: Binding[]): string {
  const out: string[] = [];
  for (const b of bs) {
    switch (b.kind) {
      case "text":
        out.push(`__stops.push(bindText(${b.target}, ()=>(${b.expr})));`);
        break;
      case "class":
        out.push(`__stops.push(bindClass(${b.target}, ()=>(${b.expr})));`);
        break;
      case "style":
        out.push(`__stops.push(bindStyle(${b.target}, ()=>(${b.expr})));`);
        break;
      case "show":
        out.push(`__stops.push(bindShow(${b.target}, ()=>!!(${b.expr})));`);
        break;
      case "attr":
        out.push(
          `__stops.push(bindAttr(${b.target}, ${JSON.stringify(b.name)}, ()=>(${
            b.expr
          })));`
        );
        break;
      case "event":
        out.push(
          `__stops.push(onEvent((ctx as any).app, ${b.target}, ${JSON.stringify(
            b.type
          )}, (${b.handler})));`
        );
        break;
      default:
        throw new CompilerError(`Unknown binding kind: ${(b as any).kind}`);
    }
  }
  return out.join("\n      ");
}
