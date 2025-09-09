export type MarwaApp = {
  _container: HTMLElement | null;
  _router?: any;
  _plugins?: Set<any>;
};

export type Plugin = {
  name?: string;
  install: (app: MarwaApp, options?: any) => void | Promise<void>;
};

export function applyPlugin(app: MarwaApp, p: Plugin, options?: any) {
  app._plugins ||= new Set();
  if (app._plugins.has(p)) return app;
  app._plugins.add(p);
  p.install(app, options);
  return app;
}
