type Factory<T> = () => Promise<T> | T;
const registry = new Map<string, Factory<any>>();
const singletons = new Map<string, any>();

export function provide(name: string, factory: Factory<any>, {singleton=true}={}) {
  registry.set(name, async ()=> {
    if (!singleton) return factory();
    if (!singletons.has(name)) singletons.set(name, await factory());
    return singletons.get(name);
  });
}

export async function use<T=any>(name: string): Promise<T> {
  const f = registry.get(name); if (!f) throw new Error(`Service not found: ${name}`);
  return f();
}
