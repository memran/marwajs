// Minimal DOM ops that the compiler will target.
// Keep it tiny—no dependencies and no Node types.

export function createElement(tag: string): HTMLElement {
  return document.createElement(tag);
}

export function createText(data = ""): Text {
  return document.createTextNode(data);
}

export function createAnchor(label = ""): Comment {
  // Useful as stable anchors (lists/conditionals)
  return document.createComment(label);
}

export function insert(
  child: Node,
  parent: Node,
  anchor: Node | null = null
): void {
  parent.insertBefore(child, anchor);
}

export function remove(child: Node): void {
  const p = child.parentNode;
  if (p) p.removeChild(child);
}

export function setText(node: Node, text: string): void {
  if (node.nodeType === Node.TEXT_NODE) {
    (node as Text).data = text;
  } else {
    (node as HTMLElement).textContent = text;
  }
}

export function setAttr(el: HTMLElement, name: string, value: unknown): void {
  if (value == null || value === false) {
    el.removeAttribute(name);
  } else if (value === true) {
    el.setAttribute(name, "");
  } else {
    el.setAttribute(name, String(value));
  }
}

export function show(el: HTMLElement, visible: boolean): void {
  // Use 'hidden' attr to avoid clobbering inline styles.
  if (visible) el.removeAttribute("hidden");
  else el.setAttribute("hidden", "");
}

export function setClass(
  el: HTMLElement,
  classes: string | Record<string, boolean>
): void {
  if (typeof classes === "string") {
    el.className = classes;
    return;
  }
  const out: string[] = [];
  for (const k in classes) if (classes[k]) out.push(k);
  el.className = out.join(" ");
}

export function setStyle(
  el: HTMLElement,
  style: Record<string, string | null | undefined>
): void {
  for (const k in style) {
    const v = style[k];
    if (v == null) (el.style as any)[k] = "";
    else (el.style as any)[k] = v;
  }
}
