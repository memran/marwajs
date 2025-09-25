// Shared types for the template compiler

export type Node =
  | { type: "el"; tag: string; attrs: Record<string, string>; children: Node[] }
  | { type: "text"; value: string };

export type Branch = { when: string; children: Node[] };

export type Warning = {
  code: string;
  message: string;
  path: number[];
  tag?: string;
};
