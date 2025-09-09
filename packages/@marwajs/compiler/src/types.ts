export type SfcParts = { template: string; script: string; style: string; route?: string };

export type CompileOptions = {
  file: string;
  directivePrefix?: string; // default ':'
  scope?: boolean;          // style scoped
  prod?: boolean;

  /** Resolve a component name to a file path for import() */
  resolveComponent?: (name: string, fromFile: string) => string | undefined;

  /** 'eager' → static import; 'lazy' → dynamic import when rendering */
  componentLoad?: 'eager' | 'lazy';
};
