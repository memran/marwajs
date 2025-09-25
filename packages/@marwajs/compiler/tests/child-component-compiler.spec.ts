import { describe, it, expect } from "vitest";
import { compileTemplateToIR } from "../src/template/compile";

function compile(html: string) {
  const ir = compileTemplateToIR(html, {
    file: "Test.marwa",
    name: "TestComp",
    scopeAttr: "data-s",
  }) as any;
  return ir;
}

describe("child component <Uppercase/> with props & events", () => {
  it("mounts a root-level <Child/> with mixed props and events (@ + m-on:)", () => {
    const ir = compile(`
      <Child :a="x" m-b="y" @save="handle($event)" m-on:close="onClose()"/>
    `);

    const m = ir.mount.join("\n");

    // Emits effect/stop and mounts to (target, anchor ?? null)
    expect(m).toMatch(/effect\(\s*\(\)\s*=>/);
    expect(m).toMatch(/\.mount\(target,\s*anchor\s*\?\?\s*null\)/);

    // Props merged: a, b and event props onSave/onClose
    expect(m).toMatch(/Object\.assign\(\{\}, \(\{\}\), \{/);
    expect(m).toMatch(/"a":\s*\(x\)/);
    expect(m).toMatch(/"b":\s*\(y\)/);

    // Events become onSave/onClose; $event → e
    expect(m).toMatch(/"onSave":\s*\(e\)=>\{\s*handle\(e\)\s*\}/);
    expect(m).toMatch(/"onClose":\s*\(e\)=>\{\s*onClose\(\)\s*\}/);

    // No DOM element is created for <Child/> (sanity check: no createElement("Child"))
    expect(ir.create.join("\n")).not.toMatch(/createElement\("Child"\)/);
  });

  it("mounts a nested <Child/> inside a DOM parent and passes props/events", () => {
    const ir = compile(`
      <div class="wrap">
        <Child :title="t" @click="onClick($event)"/>
      </div>
    `);

    const create = ir.create.join("\n");
    const mount = ir.mount.join("\n");

    // Parent <div> exists
    expect(create).toMatch(/createElement\("div"\)/);

    // Child mounts into the parent element (anchor not used within element)
    expect(mount).toMatch(/\.mount\(_e\d*,\s*null\)/);

    // Props and event mapped correctly
    expect(mount).toMatch(/"title":\s*\(t\)/);
    expect(mount).toMatch(/"onClick":\s*\(e\)=>\{\s*onClick\(e\)\s*\}/);
  });

  it("merges base m-props with per-prop overrides", () => {
    const ir = compile(`
      <Child m-props="{ id: 42, role: 'base' }" m-role="'override'" :count="n" />
    `);

    const m = ir.mount.join("\n");

    // The base object should be present as the second argument to Object.assign
    expect(m).toMatch(
      /Object\.assign\(\{\}, \(\{[^}]*id:\s*42[^}]*role:\s*'base'[^}]*\}\), \{/
    );

    // Per-prop overrides and additional props included
    expect(m).toMatch(/"role":\s*\('override'\)/);
    expect(m).toMatch(/"count":\s*\(n\)/);
  });

  it("component events ignore modifiers (no withModifiers import), $event normalized", () => {
    const ir = compile(`
      <Child @save.stop="doSave($event)" m-on:cancel.capture="doCancel()"/>
    `);

    const m = ir.mount.join("\n");

    // onSave/onCancel props created, modifiers stripped, $event → e
    expect(m).toMatch(/"onSave":\s*\(e\)=>\{\s*doSave\(e\)\s*\}/);
    expect(m).toMatch(/"onCancel":\s*\(e\)=>\{\s*doCancel\(\)\s*\}/);

    // No withModifiers import for component events
    expect(ir.imports).not.toContain("withModifiers");
  });

  it("works together with shorthand ':' on component props and m-on:event", () => {
    const ir = compile(`
      <Child :foo="a" :bar="b" m-on:done="onDone()" />
    `);
    const m = ir.mount.join("\n");

    expect(m).toMatch(/"foo":\s*\(a\)/);
    expect(m).toMatch(/"bar":\s*\(b\)/);
    expect(m).toMatch(/"onDone":\s*\(e\)=>\{\s*onDone\(\)\s*\}/);
  });

  it("does not leak reactive DOM-only keys (m-class/m-style/etc.) into component props", () => {
    const ir = compile(`
      <Child m-class="cls" m-style="st" m-show="ok" m-foo="x" />
    `);
    const m = ir.mount.join("\n");

    // must include foo but not class/style/show
    expect(m).toMatch(/"foo":\s*\(x\)/);
    expect(m).not.toMatch(/"class":/);
    expect(m).not.toMatch(/"style":/);
    expect(m).not.toMatch(/"show":/);
  });

  it("supports :model shorthand on native elements near a component (sanity regression)", () => {
    const ir = compile(`
    <input :model.number="count"/>
    <Child :a="x"/>
  `);

    // 1) Model binding is recorded in IR.bindings (compiler-level contract)
    expect(ir.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "model",
          // target is a generated var name; just ensure options.number is true
          options: expect.objectContaining({ number: true }),
        }),
      ])
    );

    // 2) Runtime import is tracked (so runner can wire bindModel)
    expect(ir.imports).toContain("bindModel");

    // 3) Child component still mounts at root
    expect(ir.mount.join("\n")).toMatch(
      /\.mount\(target,\s*anchor\s*\?\?\s*null\)/
    );
  });
});
