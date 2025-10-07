import { describe, it, expect } from "vitest";
import {
  CompilerError,
  NullOrUndefinedError,
  ensure,
  assert,
} from "../src/errors";

describe("errors: guardrails", () => {
  it("ensure throws NullOrUndefinedError", () => {
    expect(() => ensure(undefined as any, "ctx")).toThrow(NullOrUndefinedError);
  });

  it("assert throws CompilerError", () => {
    expect(() => assert(false, "nope")).toThrow(CompilerError);
  });
});
