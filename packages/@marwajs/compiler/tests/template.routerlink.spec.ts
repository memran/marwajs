import { describe, it, expect } from "vitest";
import { compileTemplateToIR } from "../src/template/compile.ts";

function compile(
  html: string,
  opts: Partial<{ file: string; name: string; scopeAttr?: string }> = {}
) {
  return compileTemplateToIR(html, {
    file: opts.file ?? "App.marwa",
    name: opts.name ?? "App",
    scopeAttr: opts.scopeAttr,
  }) as any;
}

describe("<RouterLink>", () => {
  it("static to: sets href and navigates via router.push", () => {
    const ir = compile(`<RouterLink to="/aboutus">About</RouterLink>`);
    //     console.log(
    //       "=================Compile code=============\n" +
    //         ir.binding +
    //         "\n=================End============="
    //     );

    const create = ir.create.join("\n");
    const mount = ir.mount.join("\n");
    const handlers = (ir.bindings || [])
      .filter((b: any) => b.kind === "event" && b.type === "click")
      .map((b: any) => b.handler)
      .join("\n");

    // creates <a>
    expect(create).toMatch(/createElement\('a'\)/);

    // sets href statically
    expect(mount).toMatch(
      /Dom\.setAttr\([^)]*,\s*'href',\s*["']\/aboutus["']\)/
    );

    // has click handler that prevents default and pushes the router
    expect(handlers).toMatch(/e\.preventDefault\(\)/);
    expect(handlers).toMatch(/ctx\.app\.router\.push\(["']\/aboutus["']\)/);

    // onEvent import required
    expect(ir.imports).toContain("onEvent");
  });
  // it("RouterLink without to does not reference a component", () => {
  //   const ir = compile(`<RouterLink class="btn">No Dest</RouterLink>`);
  //   const code = ir.mount.join("\n") + ir.create.join("\n");
  //   expect(code).toMatch(/createElement\('a'\)/);
  //   expect(code).not.toMatch(/\bRouterLink\b/); // no variable reference
  // });
  it("reactive :to: binds href and uses latest value in router.push", () => {
    const ir = compile(`<RouterLink :to="path">Go</RouterLink>`);
    const attrBindings = (ir.bindings || []).filter(
      (b: any) => b.kind === "attr" && b.name === "href"
    );
    const click = (ir.bindings || []).find(
      (b: any) => b.kind === "event" && b.type === "click"
    );

    // has a reactive href binding
    expect(attrBindings.length).toBe(1);
    expect(attrBindings[0].expr).toBe("path");

    // click handler calls router.push with the current expression value
    expect(click?.handler).toMatch(/router\.push\(\(\(path\)\)\)/);

    // imports include bindAttr (for reactive href) and onEvent
    expect(ir.imports).toEqual(expect.arrayContaining(["bindAttr", "onEvent"]));
  });

  it("supports standard reactive attrs on RouterLink (m-class, m-style, m-show)", () => {
    const ir = compile(
      `<RouterLink to="/a" m-class="c" m-style="{color:'red'}" m-show="ok">A</RouterLink>`
    );
    // check that the appropriate bindings are generated
    const kinds = new Set((ir.bindings || []).map((b: any) => b.kind));
    expect(kinds).toContain("class");
    expect(kinds).toContain("style");
    expect(kinds).toContain("show");
  });

  it("works inside containers and respects scopeAttr", () => {
    const ir = compile(`<div><RouterLink to="/x">X</RouterLink></div>`, {
      scopeAttr: "data-mw-x",
    });
    const create = ir.create.join("\n");
    // scopeAttr should be stamped on elements (including the <a> we create)
    expect(create).toMatch(/Dom\.setAttr\([^)]*,\s*"data-mw-x",\s*""\)/);
  });

  it("coexists with control flow (m-if)", () => {
    const ir = compile(`
    <div m-if="show">
      <RouterLink :to="next">Next</RouterLink>
    </div>
  `);

    // 1) ensure an m-if was turned into a bindSwitch cluster
    const code = ir.mount.join("\n");
    expect(code).toMatch(/bindSwitch\(/);

    // 2) the RouterLink click handler is generated inside the inline block factory,
    //    so it appears in the emitted code (not in ir.bindings)
    expect(code).toMatch(/router\.push/);

    // (optional) sanity: onEvent import is required
    expect(ir.imports).toContain("onEvent");
  });
});
