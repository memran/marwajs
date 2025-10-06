import * as parse5 from "parse5";
import { CompilerError, ensure } from "../errors";
import type { TemplateNode } from "../types";

function toAttributeMap(el: any): Record<string, string> {
  const map: Record<string, string> = {};
  const attrs = el?.attrs ?? [];
  for (const a of attrs) {
    if (!a?.name)
      throw new CompilerError("Encountered attribute without a name.");
    if (a.value == null)
      throw new CompilerError(
        `Attribute "${a.name}" has null/undefined value.`
      );
    map[a.name] = String(a.value);
  }
  return map;
}

function toTemplateNode(n: any): TemplateNode | null {
  if (!n) throw new CompilerError("Parser produced a null/undefined node.");

  if (n.nodeName === "#text") {
    const value = ensure<string>(n.value ?? "", "text:value");
    return { type: "text", value };
  }

  if (n.tagName) {
    const tag = ensure<string>(n.tagName, "element:tag");
    const attrs = toAttributeMap(n);
    const children: TemplateNode[] = [];
    for (const c of n.childNodes ?? []) {
      const mc = toTemplateNode(c);
      if (mc) children.push(mc);
    }
    return { type: "el", tag, attrs, children };
  }

  if (Array.isArray(n.childNodes)) {
    const children: TemplateNode[] = [];
    for (const c of n.childNodes) {
      const mc = toTemplateNode(c);
      if (mc) children.push(mc);
    }
    return { type: "el", tag: "#root", attrs: {}, children };
  }

  return null;
}

export function parseHTML(html: string): TemplateNode[] {
  if (html == null)
    throw new CompilerError("HTML input must not be null or undefined.");
  const frag = parse5.parseFragment(String(html)) as any;
  const root = toTemplateNode(frag);
  if (!root || root.type !== "el" || root.tag !== "#root") {
    throw new CompilerError("Internal parser error: expected a root element.");
  }
  return root.children;
}
