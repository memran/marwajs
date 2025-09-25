import type { Node, Warning } from "./types.js";
import { normalizeAttrs } from "./attrs.js";
import {
  hasIf,
  hasSwitch,
  hasFor,
  hasMount,
  hasKey,
  hasElseIf,
  hasElse,
  hasCase,
  hasDefault,
} from "./clusters.js";
import { isComponentTag } from "./utils.js";

// Collect non-fatal warnings during parse time
export function collectWarnings(ast: Node[]): Warning[] {
  const warnings: Warning[] = [];
  const pushWarn = (w: Warning) => warnings.push(w);

  // Determine primary controls declared on a single element
  function primaryControls(n: { tag: string; attrs: Record<string, string> }) {
    const a = n.attrs;
    const list: string[] = [];
    if (hasIf(a)) list.push("m-if");
    if (hasSwitch(a)) list.push("m-switch");
    if (hasFor(a)) list.push("m-for");
    if (hasMount(a)) list.push("m-mount");
    if (isComponentTag(n.tag)) list.push("<Component>");
    return list;
  }

  function validateNode(n: Node, path: number[]) {
    if (n.type !== "el") return;
    const a = ((n as any).attrs = normalizeAttrs((n as any).attrs || {}));
    const prim = primaryControls(n as any);

    if (prim.length > 1) {
      pushWarn({
        code: "MULTIPLE_PRIMARY",
        message: `conflict: multiple control directives on the same node: ${prim.join(
          ", "
        )}`,
        path,
        tag: (n as any).tag,
      });
    }

    if (hasKey(a) && !hasFor(a)) {
      pushWarn({
        code: "KEY_WITHOUT_FOR",
        message: "`m-key` is only valid together with `m-for`.",
        path,
        tag: (n as any).tag,
      });
    }

    if (isComponentTag((n as any).tag) && hasMount(a)) {
      pushWarn({
        code: "COMPONENT_AND_MOUNT",
        message:
          "Using both `<Component/>` and `m-mount` is redundant; use only one.",
        path,
        tag: (n as any).tag,
      });
    }
  }

  function validateSiblings(siblings: Node[], basePath: number[]) {
    for (let i = 0; i < siblings.length; i++) {
      const n = siblings[i];
      if (n.type !== "el") continue;
      const a = ((n as any).attrs = normalizeAttrs((n as any).attrs || {}));

      if (hasElseIf(a) || hasElse(a)) {
        const prev = siblings[i - 1] as any;
        const ok =
          prev &&
          prev.type === "el" &&
          (hasIf(normalizeAttrs(prev.attrs || {})) ||
            hasElseIf(normalizeAttrs(prev.attrs || {})));
        if (!ok) {
          pushWarn({
            code: "MISPLACED_ELSE",
            message:
              "`m-else-if`/`m-else` must immediately follow an element with `m-if` or `m-else-if`.",
            path: basePath.concat(i),
            tag: (n as any).tag,
          });
        }
        const prim = primaryControls(n as any).filter((p) => p !== "m-if");
        if (prim.length) {
          pushWarn({
            code: "BRANCH_WITH_PRIMARY",
            message: `Branch element should not also declare primary controls: ${prim.join(
              ", "
            )}`,
            path: basePath.concat(i),
            tag: (n as any).tag,
          });
        }
      }

      if (hasCase(a) || hasDefault(a)) {
        const prev = siblings[i - 1] as any;
        const prevAttrs =
          prev && prev.type === "el" ? normalizeAttrs(prev.attrs || {}) : {};
        const ok =
          prev &&
          prev.type === "el" &&
          (hasSwitch(prevAttrs) || hasCase(prevAttrs));
        if (!ok) {
          pushWarn({
            code: "MISPLACED_CASE",
            message:
              "`m-case`/`m-default` must immediately follow an element with `m-switch` or a previous `m-case`.",
            path: basePath.concat(i),
            tag: (n as any).tag,
          });
        }
        const prim = primaryControls(n as any).filter((p) => p !== "m-switch");
        if (prim.length) {
          pushWarn({
            code: "CASE_WITH_PRIMARY",
            message: `Switch branch should not also declare primary controls: ${prim.join(
              ", "
            )}`,
            path: basePath.concat(i),
            tag: (n as any).tag,
          });
        }
      }

      validateNode(n, basePath.concat(i));
      validateSiblings((n as any).children || [], basePath.concat(i));
    }
  }

  validateSiblings(ast, []);
  return warnings;
}
