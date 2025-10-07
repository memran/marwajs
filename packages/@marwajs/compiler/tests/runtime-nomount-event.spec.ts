import { describe, it, expect } from "vitest";
import { generateComponent } from "../src/codegen";

describe("runtime: event handler is not invoked at mount", () => {
  it("wraps the handler in a function (no immediate call)", () => {
    const code = generateComponent({
      file: "f",
      name: "Cmp",
      create: ["const b = Dom.createElement('button');"],
      mount: ["Dom.insert(b, target);"],
      bindings: [
        { kind: "event", target: "b", type: "click", handler: "boom()" },
      ],
      imports: ["Dom"],
    });

    // Avoid regex with nested parens; look for the concrete emitted snippet.
    expect(code).toContain(
      `onEvent((ctx as any).app, b, "click", (e)=>(boom()))`
    );
    // sanity: ensure we didn't inline-call at mount (would look like ... , boom()))
    expect(code).not.toContain(`onEvent((ctx as any).app, b, "click", boom())`);
  });
});
