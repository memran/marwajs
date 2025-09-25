import { describe, it, expect } from "vitest";
import { compile } from "./test-utils";

describe("template micro compiler", () => {
  it("normalizes :attr and @event", () => {
    const ir = compile(`<div :title="t" @click="x()" />`);
    expect(ir.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "attr", name: "title" }),
        expect.objectContaining({ kind: "event", type: "click" }),
      ])
    );
  });

  it("event modifiers and keys", () => {
    const ir = compile(`<input @keydown.enter.prevent="hit()" />`);
    expect(ir.imports).toContain("withModifiers");
    const ev = ir.bindings.find((b: any) => b.kind === "event");
    expect(ev?.handler).toMatch(/includes\(e.key\)/);
    expect(ev?.handler).toMatch(/withModifiers/);
  });

  it("model refs vs signals", () => {
    const ir1 = compile(`<input m-model="count" />`);
    const m1 = ir1.bindings.find((b: any) => b.kind === "model");
    expect(m1?.get).toBe("count()");
    expect(m1?.set).toBe("count.set($_)");

    const ir2 = compile(`<input m-model="countRef.value" />`);
    const m2 = ir2.bindings.find((b: any) => b.kind === "model");
    expect(m2?.get).toBe("countRef.value");
    expect(m2?.set).toBe("countRef.value = $_");
  });

  it("for + key emits bindFor with factory", () => {
    const ir = compile(`<li m-for="(it,i) in list" m-key="it.id">x</li>`);
    expect(ir.mount.join("\n")).toMatch(/bindFor\(/);
    expect(ir.mount.join("\n")).toMatch(/\(it, i\)\s*=>\s*\(it\.id\)/);
  });

  it("if / else-if / else collapses to one bindSwitch", () => {
    const ir = compile(`
    <div m-if="a">A</div>
    <div m-else-if="b">B</div>
    <div m-else>C</div>
  `);
    const code = ir.mount.join("\n");
    expect(code.match(/bindSwitch\(/g)?.length).toBe(1);
  });

  it("switch / case / default", () => {
    const ir = compile(`
    <div m-switch="k"></div>
    <template m-case="'x'">X</template>
    <template m-case="'y'">Y</template>
    <template m-default>DEF</template>
  `);
    expect(ir.mount.join("\n")).toMatch(/bindSwitch\(/);
  });

  it("scopeAttr stamped on elements only", () => {
    const ir = compile(`<div>hi {{a}}</div>`, "data-mw-x");
    expect(ir.create.join("\n")).toMatch(/Dom\.setAttr\(.+data-mw-x/);
    // ensure text create doesn't set scopeAttr
    expect(ir.create.join("\n")).not.toMatch(/createText\(.+\)\s*;.*setAttr/);
  });

  it("warnings: key without for", () => {
    const ir = compile(`<div m-key="id"></div>`);
    expect((ir as any).warnings.join(" ")).toMatch(/m-key.*valid.*m-for/i);
  });
});
