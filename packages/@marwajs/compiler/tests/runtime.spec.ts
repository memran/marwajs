// tests/runtime.spec.ts
import { describe, it, expect } from "vitest";
import { compileTemplateToIR } from "../src/index";
import { generateComponent } from "../src/codegen";
import { loadComponentFromCode } from "./runtime/execute";
import { nextTick } from "@marwajs/core";

function mountToContainer() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const anchor = null;
  return { host, anchor };
}

describe("runtime execution (happy-dom)", () => {
  it("renders static DOM", () => {
    const ir = compileTemplateToIR('<div id="a">hello</div>', {
      file: "a",
      name: "A",
    });
    const code = generateComponent(ir);
    const C = loadComponentFromCode(code);
    const inst = C({}, { app: {} });
    const { host, anchor } = mountToContainer();
    inst.mount(host, anchor);
    expect(host.innerHTML).toContain('<div id="a">hello</div>');
    inst.destroy();
  });

  //   it("binds text interpolation", async () => {
  //     const ir = compileTemplateToIR("<p>hello {{name}}</p>", {
  //       file: "b",
  //       name: "B",
  //     });
  //     const code = generateComponent(ir);
  //     const C = loadComponentFromCode(code);

  //     let name = "Marwa";
  //     const ctx = { app: {} };
  //     const inst = C({}, ctx);
  //     const { host, anchor } = mountToContainer();
  //     inst.mount(host, anchor);

  //     // first paint should show empty string for bound text, then polling updates
  //     await new Promise((r) => setTimeout(r, 3));
  //     expect(host.textContent).toContain("hello");

  //     // change backing value by overriding global getter closure
  //     // Our minimal binder captures the getter; rebuild a tiny component where getter reads outer var
  //     // (already true). Update and wait a tick.
  //     name = "JS";
  //     await new Promise((r) => setTimeout(r, 3));
  //     // The getter in bindText uses current closure value
  //     // But our sample used direct expression "name", not reactive. In real runtime
  //     // signals drive effects; here we just assert binder runs with latest value.
  //     // To simulate, we re-mount with a new closure value.
  //     inst.destroy();
  //     const C2 = loadComponentFromCode(
  //       generateComponent(
  //         compileTemplateToIR("<p>hello {{name}}</p>", { file: "b2", name: "B2" })
  //       )
  //     );
  //     const inst2 = C2({}, ctx);
  //     const host2 = document.createElement("div");
  //     document.body.appendChild(host2);
  //     inst2.mount(host2, null);
  //     await new Promise((r) => setTimeout(r, 3));
  //     expect(host2.textContent).toContain("hello");
  //     inst2.destroy();
  //   });

  //   it("applies m-class and m-style and m-show", async () => {
  //     const ir = compileTemplateToIR(
  //       '<div m-class="klass" m-style="{color: "red"}" m-show="true">x</div>',
  //       { file: "c", name: "C" }
  //     );
  //     const code = generateComponent(ir);
  //     const C = loadComponentFromCode(code);
  //     const inst = C({}, { app: {} });
  //     const { host } = mountToContainer();
  //     inst.mount(host, null);
  //     await new Promise((r) => setTimeout(r, 3));
  //     const el = host.querySelector("div") as HTMLElement;
  //     expect(el.className).toBe("klass");
  //     expect(el.style.color).toBe("red");
  //     expect(el.style.display).not.toBe("none");
  //     inst.destroy();
  //   });

  //   it("wires @click handler", async () => {
  //     const ir = compileTemplateToIR('<button @click="onClick">Tap</button>', {
  //       file: "d",
  //       name: "D",
  //     });
  //     const code = generateComponent(ir);
  //     const C = loadComponentFromCode(code);
  //     const calls: any[] = [];
  //     (globalThis as any).onClick = (e: Event) => calls.push(e.type);

  //     const inst = C({}, { app: {} });
  //     const { host } = mountToContainer();
  //     inst.mount(host, null);
  //     const btn = host.querySelector("button")!;
  //     btn.click();
  //     await nextTick();
  //     expect(calls).toEqual(["click"]);
  //     inst.destroy();
  //   });
});
