export class CompilerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompilerError";
  }
}
export class NullOrUndefinedError extends CompilerError {
  constructor(where: string, detail?: string) {
    super(
      `Null or undefined is not allowed in ${where}${
        detail ? `: ${detail}` : ""
      }.`
    );
    this.name = "NullOrUndefinedError";
  }
}
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CompilerError(message);
}
export function ensure<T>(value: T | null | undefined, where: string): T {
  if (value == null) throw new NullOrUndefinedError(where);
  return value;
}
