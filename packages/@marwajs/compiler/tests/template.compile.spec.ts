import { describe, it, expect } from "vitest";
import { compile } from "./test-utils";

const text = (...chunks: string[]) => chunks.join("\n");
const count = (s: string, needle: RegExp | string) => {
  const re =
    typeof needle === "string"
      ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
      : needle;
  return (s.match(re) || []).length;
};

describe("template compiler - negative cases", () => {
  it("does not duplicate bindSwitch when clusters are separated by unrelated siblings", () => {
    const ir = compile(
      text(`<div m-if="a">A</div>`, `<span>plain</span>`, `<div>tail</div>`)
    );
    const m = ir.mount.join("\n");
    expect(count(m, /bindSwitch\(/g)).toBe(1);
  });

  it("two independent if-clusters produce exactly two bindSwitch (no extra)", () => {
    const ir = compile(
      text(`<div m-if="a">A</div>`, `<p>plain</p>`, `<div m-if="b">B</div>`)
    );
    const m = ir.mount.join("\n");
    expect(count(m, /bindSwitch\(/g)).toBe(2);
  });

  it("conflicting m-if + m-for on the SAME node: should not emit both bindSwitch and bindFor", () => {
    const ir = compile(`<li m-if="ok" m-for="x in xs">{{x}}</li>`);
    const out = ir.mount.join("\n") + "\n" + ir.create.join("\n");
    const hasSwitch = /bindSwitch\(/.test(out);
    const hasFor = /bindFor\(/.test(out);

    // Current behavior in compiler: one of them should win, but not both.
    expect(hasSwitch && hasFor).toBe(false);

    // Optional diagnostic if you add warnings later:
    const warnings: string[] = (ir as any).warnings ?? [];
    // If diagnostics exist, assert there's a conflict warning.
    if (warnings.length) {
      expect(
        warnings.some(
          (w) => /conflict/i.test(w) && /m-if/.test(w) && /m-for/.test(w)
        )
      ).toBe(true);
    }
  });

  it("dangling m-default without preceding m-switch does not emit bindSwitch", () => {
    const ir = compile(`<div m-default>fallback</div>`);
    const m = ir.mount.join("\n");
    expect(m).not.toMatch(/bindSwitch\(/);
  });
});
describe("template compiler - normalization & clusters", () => {
  it("normalizes ':' shorthand to 'm-' for reactive attrs", () => {
    const ir = compile(
      `<div :title="t" :class="c" :style="s" :show="ok"></div>`
    );
    const m = ir.mount.join("\n");
    const b = ir.bindings;
    // :class / :style / :show go to bindings
    expect(b).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "class" }),
        expect.objectContaining({ kind: "style" }),
        expect.objectContaining({ kind: "show" }),
      ])
    );
    // :title becomes bindAttr 'title'
    expect(b).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "attr", name: "title" }),
      ])
    );
    // scope attribute should be set on created element
    expect(ir.create.join("\n")).toMatch(/Dom\.setAttr\(.+?, "data-s", ""\)/);
  });

  it("normalizes m-on and @ equally, preserving modifiers and keys", () => {
    const ir = compile(`
    <button m-on:click.stop="x=1" @keydown.enter="onKey($event)"/>
  `);

    // Events on a normal DOM element are emitted into bindings, not mount.
    const evts = ir.bindings.filter((b: any) => b.kind === "event");

    // We should have both click & keydown events
    expect(evts.map((e: any) => e.type).sort()).toEqual(["click", "keydown"]);

    // click.stop should be wrapped with withModifiers(...)
    const click = evts.find((e: any) => e.type === "click");
    expect(click.handler).toMatch(/withModifiers\(/);

    // keydown.enter should include a key filter and pass $event as 'e'
    const keydown = evts.find((e: any) => e.type === "keydown");
    expect(keydown.handler).toMatch(/includes\(e\.key\)/);
    expect(keydown.handler).toMatch(/onKey\(e\)/);

    // Ensure runtime imports include withModifiers (due to .stop)
    expect(ir.imports).toContain("withModifiers");
  });
  it("emits bindModel import when model is inside an inline block", () => {
    const ir = compile(`
    <template m-if="ok">
      <input m-model="v"/>
    </template>
  `);
    // inline factories add runtime imports immediately
    expect(ir.imports).toContain("bindModel");
  });
  it("supports m-model via ':' shorthand with modifiers", () => {
    const ir = compile(`
    <input :model.number="count" />
    <input m-model.trim.lazy="name" />
  `);

    // 1) There should be two model bindings
    const models = ir.bindings.filter((b: any) => b.kind === "model");
    expect(models).toHaveLength(2);

    // 2) First has { number: true }
    expect(models[0]).toEqual(
      expect.objectContaining({
        kind: "model",
        target: expect.any(String),
        get: expect.stringMatching(/count(\(\))?$|count\.value$/), // signal or ref
        options: expect.objectContaining({ number: true }),
      })
    );

    // 3) Second has { trim: true, lazy: true }
    expect(models[1]).toEqual(
      expect.objectContaining({
        kind: "model",
        target: expect.any(String),
        get: expect.stringMatching(/name(\(\))?$|name\.value$/),
        options: expect.objectContaining({ trim: true, lazy: true }),
      })
    );

    // Optional: ensure elements were created (scope attr present)
    expect(ir.create.join("\n")).toMatch(/createElement\("input"\)/);
    expect(ir.create.join("\n")).toMatch(/Dom\.setAttr\(.+?, "data-s", ""\)/);
  });

  it("m-if / m-else-if / m-else cluster on non-template element", () => {
    const ir = compile(`
      <div m-if="ok">A</div>
      <span m-else-if="maybe">B</span>
      <em m-else>C</em>
    `);
    const mount = ir.mount.join("\n");
    // bindSwitch used once at root
    expect(mount).toMatch(/bindSwitch\(target/);
    // branches include factories for A,B,C
    expect(mount).toMatch(/factory:\s*\(/);
    expect(ir.imports).toContain("bindSwitch");
  });

  it("m-switch / m-case / m-default cluster on non-template element", () => {
    const ir = compile(`
      <p m-switch="state"></p>
      <b m-case="'a'">A</b>
      <i m-case="'b'">B</i>
      <u m-default>U</u>
    `);
    const mount = ir.mount.join("\n");
    expect(mount).toMatch(/bindSwitch\(target/);
    expect(mount).toMatch(/==/); // equality check compiled
  });

  it("m-for on non-template element repeats the element itself", () => {
    const ir = compile(
      `<li m-for="(item,i) in items" m-key="item.id">{{item}}</li>`
    );
    const mount = ir.mount.join("\n");
    // bindFor should be used on target
    expect(mount).toMatch(/bindFor\(target/);
    // factory should create an <li>
    const create = ir.mount.concat(ir.create).join("\n");
    expect(create).toMatch(/createElement\("li"\)/);
    expect(ir.imports).toContain("bindFor");
  });

  it("<Child/> component tag mounts like m-mount", () => {
    const ir = compile(`<Child/>`);
    const m = ir.mount.join("\n");
    // should create effect/stop and call child.mount(target, anchor)
    expect(m).toMatch(/effect\(\s*\(\)\s*=>/);
    expect(m).toMatch(/\.mount\(target,\s*anchor\s*\?\?\s*null\)/);
    expect(ir.imports).toEqual(expect.arrayContaining(["effect", "stop"]));
  });

  it("m-mount with mixed props: m-*, :prop, and events (@ / m-on)", () => {
    const ir = compile(`
      <div m-mount="Child" m-foo="a" :bar="b" @save="onSave($event)" m-on:close="onClose()"/>
    `);
    const m = ir.mount.join("\n");
    // Should build merged props including foo, bar and onSave/onClose
    expect(m).toMatch(/Object\.assign\(\{\}, \(\{\}\), \{.*"foo":\s*\(a\)/s);
    expect(m).toMatch(/"bar":\s*\(b\)/);
    expect(m).toMatch(/"onSave":\s*\(e\)=>\{/);
    expect(m).toMatch(/"onClose":\s*\(e\)=>\{/);
    // and mount the component
    expect(m).toMatch(/\.mount\(/);
  });
});
