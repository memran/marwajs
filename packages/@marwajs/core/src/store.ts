type Listener = () => void;

export function createStore<T extends object>(state: T) {
  const listeners = new Set<Listener>();
  const proxy = new Proxy(state, {
    set(t,k,v){ (t as any)[k]=v; listeners.forEach(l=>l()); return true; }
  });
  return {
    state: proxy as T,
    subscribe(fn: Listener){ listeners.add(fn); return ()=>listeners.delete(fn); }
  };
}
