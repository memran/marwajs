import { CompilerError } from "./errors";
/** Parse "@click" → { type: "click" } with validation. */
export function parseEventAttribute(name: string): { type: string } {
  if (!name || name[0] !== "@")
    throw new CompilerError(`Invalid event attribute: ${name}`);
  const type = name.slice(1).trim();
  if (!type)
    throw new CompilerError("Event type must not be empty (e.g., @click).");
  return { type };
}
