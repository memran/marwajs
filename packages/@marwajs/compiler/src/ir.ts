// IR (intermediate representation) contracts the compiler will emit.

export type Slot = number; // future: named slots / fragments

export interface TextBinding {
  kind: "text";
  target: string; // local var name for Text node
  expr: string; // JS expr to compute text
}

export interface HTMLBinding {
  kind: "html";
  target: string; // HTMLElement var
  expr: string; // JS expr that returns HTML string
}

export interface ShowBinding {
  kind: "show";
  target: string; // HTMLElement var
  expr: string; // boolean expr
}

export interface ClassBinding {
  kind: "class";
  target: string; // HTMLElement var
  expr: string; // string or Record<string, boolean>
}

export interface StyleBinding {
  kind: "style";
  target: string; // HTMLElement var
  expr: string; // Record<string,string|null|undefined>
}

export interface EventBinding {
  kind: "event";
  target: string; // HTMLElement var
  type: string; // 'click', 'input', ...
  handler: string; // function expression
}

export interface ModelBinding {
  kind: "model";
  target: string; // input/select/textarea var
  get: string; // getter expr
  set: string; // setter expr (value param is '$_')
  options?: { lazy?: boolean; trim?: boolean; number?: boolean; type?: string };
}
export interface ForBinding {
  kind: "for";
  parent: string; // parent var name (Element or Anchor parent)
  listExpr: string; // JS expr returns array
  keyExpr: string; // (item, index) => key, emitted inline as function
  factory: string; // function (item, index) => Block
}

export interface AttrBinding {
  kind: "attr";
  target: string;
  name: string; // attribute name, e.g. 'id', 'src', 'aria-label'
  expr: string; // expression producing value
}

export type Binding =
  | TextBinding
  | HTMLBinding
  | ShowBinding
  | ClassBinding
  | StyleBinding
  | EventBinding
  | ModelBinding
  | ForBinding
  | AttrBinding;

export interface ComponentIR {
  file: string;
  name: string;
  create: string[]; // lines of JS to create static nodes
  mount: string[]; // lines of JS to insert nodes
  bindings: Binding[]; // reactive directive calls
  destroy?: string[];

  // add these to avoid casts
  imports?: string[]; // extra runtime imports (e.g., ['bindIf'])
  prelude?: string[]; // setup snippets injected into component setup
}
