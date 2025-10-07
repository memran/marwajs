import { CompilerError } from "./errors";
import type { TemplateNode } from "./types";

export interface IfBranch {
  testExpr: string | null;
  node: TemplateNode;
}
export interface IfChain {
  branches: IfBranch[];
  consumedTo: number;
}
export interface SwitchCase {
  matchExpr: string | null;
  node: TemplateNode;
}
export interface SwitchCluster {
  switchOn: string;
  cases: SwitchCase[];
  consumedTo: number;
}

// presence-only checks; value is validated in collectors
export function hasIfDirective(
  attrs: Record<string, unknown> | undefined
): boolean {
  return !!attrs && Object.prototype.hasOwnProperty.call(attrs, "m-if");
}
export function hasSwitchDirective(
  attrs: Record<string, unknown> | undefined
): boolean {
  return !!attrs && Object.prototype.hasOwnProperty.call(attrs, "m-switch");
}

// NEW: ignore whitespace-only text nodes between control-flow siblings
function isWhitespaceText(n: TemplateNode | undefined): boolean {
  return !!n && n.type === "text" && (!n.value || n.value.trim() === "");
}

/** Collect m-if → (m-else-if)* → (m-else)? allowing whitespace-only text nodes between. */
export function collectIfChain(
  siblings: TemplateNode[],
  start: number
): IfChain {
  if (!Array.isArray(siblings))
    throw new CompilerError("collectIfChain: siblings must be an array.");
  if (start < 0 || start >= siblings.length)
    throw new CompilerError("collectIfChain: start index out of range.");

  // skip any leading whitespace (defensive; caller should pass element)
  let i = start;
  while (i < siblings.length && isWhitespaceText(siblings[i])) i++;
  if (i >= siblings.length)
    throw new CompilerError("collectIfChain: missing m-if host.");
  const first = siblings[i];
  if (!first || first.type !== "el")
    throw new CompilerError("collectIfChain: first node must be an element.");
  const a0 = (first.attrs ?? {}) as Record<string, unknown>;
  const rawIf = a0["m-if"];
  if (typeof rawIf !== "string" || rawIf.trim().length === 0)
    throw new CompilerError("m-if requires a non-empty expression.");

  const out: IfBranch[] = [{ testExpr: rawIf.trim(), node: first }];
  i++; // move past host

  let seenElse = false;
  while (i < siblings.length) {
    // allow whitespace between branches
    while (i < siblings.length && isWhitespaceText(siblings[i])) i++;
    if (i >= siblings.length) break;

    const n = siblings[i];
    if (!n || n.type !== "el") break;
    const a = (n.attrs ?? {}) as Record<string, unknown>;

    if (Object.prototype.hasOwnProperty.call(a, "m-else-if")) {
      if (seenElse)
        throw new CompilerError("m-else-if cannot appear after m-else.");
      const raw = a["m-else-if"];
      if (typeof raw !== "string" || raw.trim().length === 0)
        throw new CompilerError("m-else-if requires a non-empty expression.");
      out.push({ testExpr: raw.trim(), node: n });
      i++;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(a, "m-else")) {
      if (seenElse)
        throw new CompilerError("Only one m-else is allowed in an if-chain.");
      out.push({ testExpr: null, node: n });
      seenElse = true;
      i++;
      break; // else is terminal
    }

    break; // chain ends
  }

  return { branches: out, consumedTo: i - 1 };
}

/** Collect m-switch host followed by m-case/m-default, allowing whitespace-only text nodes between. */
export function collectSwitchCluster(
  siblings: TemplateNode[],
  start: number
): SwitchCluster {
  if (!Array.isArray(siblings))
    throw new CompilerError("collectSwitchCluster: siblings must be an array.");
  if (start < 0 || start >= siblings.length)
    throw new CompilerError("collectSwitchCluster: start index out of range.");

  // skip leading whitespace (defensive)
  let i = start;
  while (i < siblings.length && isWhitespaceText(siblings[i])) i++;
  if (i >= siblings.length)
    throw new CompilerError("collectSwitchCluster: missing m-switch host.");

  const host = siblings[i];
  if (!host || host.type !== "el")
    throw new CompilerError("collectSwitchCluster: host must be an element.");

  const ah = (host.attrs ?? {}) as Record<string, unknown>;
  const rawSwitch = ah["m-switch"];
  if (typeof rawSwitch !== "string" || rawSwitch.trim().length === 0)
    throw new CompilerError("m-switch requires a non-empty expression.");

  const cases: SwitchCase[] = [];
  i++; // past host

  let seenDefault = false;
  while (i < siblings.length) {
    while (i < siblings.length && isWhitespaceText(siblings[i])) i++;
    if (i >= siblings.length) break;

    const n = siblings[i];
    if (!n || n.type !== "el") break;
    const a = (n.attrs ?? {}) as Record<string, unknown>;

    if (Object.prototype.hasOwnProperty.call(a, "m-case")) {
      if (seenDefault)
        throw new CompilerError("m-case cannot appear after m-default.");
      const raw = a["m-case"];
      if (typeof raw !== "string" || raw.trim().length === 0)
        throw new CompilerError("m-case requires a non-empty expression.");
      cases.push({ matchExpr: raw.trim(), node: n });
      i++;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(a, "m-default")) {
      if (seenDefault)
        throw new CompilerError(
          "Only one m-default is allowed in a switch cluster."
        );
      cases.push({ matchExpr: null, node: n });
      seenDefault = true;
      i++;
      break; // default is terminal
    }

    break;
  }

  if (cases.length === 0)
    throw new CompilerError(
      "m-switch must be followed by at least one m-case or m-default sibling."
    );

  return { switchOn: rawSwitch.trim(), cases, consumedTo: i - 1 };
}
