export interface SFC {
  filename: string;
  template?: string | null;
  script?: string | null;
  style?: string | null;
}

export interface CompileOptions {
  filename?: string;
  dev?: boolean;
}

export function readSFC(filename: string, src: string): SFC {
  // MVP placeholder: split very naively, replaced in Phase 5
  return { filename, script: src, template: null, style: null };
}

export function compileSFC(
  sfc: SFC,
  _opts: CompileOptions = {}
): { code: string; map?: any } {
  // MVP: passthrough script so Phase 0 consumers can depend on API shape
  const code = sfc.script ?? "";
  return { code };
}
