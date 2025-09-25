import { has } from "./utils.js";

export const BEHAVIOR_MODS = new Set<string>([
  "stop",
  "prevent",
  "self",
  "once",
  "capture",
  "passive",
]);

export const KEY_MAP: Record<string, string[]> = {
  enter: ["Enter"],
  esc: ["Escape"],
  escape: ["Escape"],
  space: [" ", "Spacebar"],
  tab: ["Tab"],
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  delete: ["Delete"],
  backspace: ["Backspace"],
};

export function splitMods(raw: string) {
  const parts = raw.split(".");
  const type = parts.shift()!;
  const behavior = parts.filter((m) => BEHAVIOR_MODS.has(m));
  const keymods = parts.filter((m) => has(KEY_MAP, m));
  return { type, behavior, keymods };
}

export function buildEventHandler(
  code: string,
  behavior: string[],
  keymods: string[]
) {
  const body = code.replace(/\$event/g, "e");
  let handler = `(e)=>{ ${body} }`;

  if (keymods.length) {
    const keys = keymods.map((k) => KEY_MAP[k]).flat();
    handler = `(e)=>{ if (!(${JSON.stringify(
      keys
    )}).includes(e.key)) return; ${body} }`;
  }
  if (behavior.length) {
    handler = `withModifiers(${handler}, [${behavior
      .map((m) => JSON.stringify(m))
      .join(",")}])`;
  }
  return handler;
}
