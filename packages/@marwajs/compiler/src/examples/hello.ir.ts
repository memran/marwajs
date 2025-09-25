import type { ComponentIR } from "../ir.js";

const ir: ComponentIR & { imports?: string[]; prelude?: string[] } = {
  file: "Hello.marwa",
  name: "Hello",
  imports: ["signal"], // we’ll use signal in prelude
  prelude: [
    // local state (signals-first core ✅)
    `const count = signal(0);`,
  ],
  create: [
    `const root = Dom.createElement('div');`,
    `const h = Dom.createElement('h1');`,
    `const tn = Dom.createText('');`,
    `Dom.insert(tn, h);`,
    `const btn = Dom.createElement('button');`,
    `Dom.setText(btn, 'inc');`,
    `Dom.insert(h, root);`,
    `Dom.insert(btn, root);`,
  ],
  mount: [`Dom.insert(root, target, anchor ?? null);`],
  bindings: [
    { kind: "text", target: "tn", expr: "`Count: ${count()}`" },
    {
      kind: "event",
      target: "btn",
      type: "click",
      handler: `(e)=>{ count.set(count()+1); }`,
    },
  ],
};

export default ir;
