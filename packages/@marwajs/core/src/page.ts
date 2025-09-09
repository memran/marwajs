export type PageConfig = {
  title?: string;
  meta?: Record<string, any>;
  middleware?: Array<(ctx:any, next: ()=>Promise<void>|void)=>any>;
  guards?: Array<(to:string, from:string, ctx:any)=>boolean|string|Promise<boolean|string>>;
  layout?: string; // optional logical layout name (handled by generator)
};

export function definePage(cfg: PageConfig){ return cfg; }

// optional grouping DSL for future extensions
export type RouteGroup = Omit<PageConfig, 'title'> & { base?: string };
export function defineRouteGroup(cfg: RouteGroup){ return cfg; }
