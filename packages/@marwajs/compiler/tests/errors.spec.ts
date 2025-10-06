import { describe, it, expect } from "vitest";
import {
  CompilerError,
  NullOrUndefinedError,
  assert,
  ensure,
} from "../src/errors";

describe("errors module", () => {
  it("creates CompilerError with readable message", () => {
    const err = new CompilerError("hello");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("hello");
  });

  it("creates NullOrUndefinedError with context", () => {
    const err = new NullOrUndefinedError("compile", "missing node");
    expect(err.message).toContain("compile");
  });

  it("assert() throws when condition false", () => {
    expect(() => assert(false, "fail")).toThrow(CompilerError);
    expect(() => assert(true, "ok")).not.toThrow();
  });

  it("ensure() returns same value or throws", () => {
    expect(ensure("x", "test")).toBe("x");
    expect(() => ensure(null, "here")).toThrow(NullOrUndefinedError);
  });
});
