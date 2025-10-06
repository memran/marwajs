export type Binding =
  | { kind: "text"; target: string; expr: string }
  | { kind: "class"; target: string; expr: string }
  | { kind: "style"; target: string; expr: string }
  | { kind: "show"; target: string; expr: string }
  | { kind: "attr"; target: string; name: string; expr: string }
  | { kind: "event"; target: string; type: string; handler: string };

export interface ComponentIR {
  file: string;
  name: string;
  create: string[];
  mount: string[];
  bindings: Binding[];
  imports: string[];
}
