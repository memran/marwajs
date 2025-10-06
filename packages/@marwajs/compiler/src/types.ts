export type TemplateNode =
  | {
      type: "el";
      tag: string;
      attrs: Record<string, string>;
      children: TemplateNode[];
    }
  | { type: "text"; value: string };

export interface SFC {
  template: string;
  script: { content: string; lang: "js" | "ts" } | null;
  style: { content: string; scoped: boolean } | null;
}

export interface CompileOptions {
  file: string;
  name: string;
  scopeAttr?: string;
  strict?: boolean; // default true
}
