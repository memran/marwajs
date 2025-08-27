// Lightweight global store built into @marwajs/core
import { reactive, computed } from './reactivity'

import { provide, inject } from './runtime' // or wherever yours live

export function provideStore(id: string, store: any) {
  provide(`mw:store:${id}`, store)
}
export function injectStore(id: string) {
  return inject(`mw:store:${id}`)
}

// Simple types kept inline (works as JS too)
type Obj = Record<string, any>
type StoreDef = {
  state: () => Obj
  getters?: Record<string, (state: Obj) => any>
  actions?: Record<string, (this: any, ...args: any[]) => any>
}

const __stores = new Map<string, any>()

/**
 * create a proxy that exposes:
 * - state props at top-level (count -> state.count)
 * - getters as getters
 * - actions as bound methods (this = proxy)
 * plus $id, $state (reactive), $patch, $reset
 */
function makeStoreObject(id: string, def: StoreDef) {
  const state = reactive(def.state ? def.state() : {})

  const target: Obj = {
    $id: id,
    $state: state,
    $patch(partial: Obj | ((s: Obj) => void)) {
      if (typeof partial === 'function') {
        partial(state)
      } else {
        Object.assign(state, partial)
      }
    },
    $reset() {
      Object.assign(state, def.state ? def.state() : {})
    }
  }

  // getters -> defineProperty getters
  if (def.getters) {
    for (const [k, fn] of Object.entries(def.getters)) {
      const c = computed(() => fn(state))
      Object.defineProperty(target, k, { get: () => c.value })
    }
  }

  // actions -> bound to proxy later (we attach, then bind in proxy handler)
  if (def.actions) {
    for (const [name, fn] of Object.entries(def.actions)) {
      target[name] = fn
    }
  }

  // Proxy: flatten state to top-level (DX: store.count)
  const proxy = new Proxy(target, {
    get(obj, key, recv) {
      if (key in obj) return Reflect.get(obj, key, recv)
      // fallback to state
      return (state as any)[key as any]
    },
    set(obj, key, value, recv) {
      if (key in obj) return Reflect.set(obj, key, value, recv)
      ;(state as any)[key as any] = value
      return true
    },
    has(obj, key) {
      return key in obj || key in state
    },
    // bind actions to proxy so this = store
    getOwnPropertyDescriptor(obj, key) {
      const d = Object.getOwnPropertyDescriptor(obj, key)
      if (d && typeof (obj as any)[key] === 'function') {
        // ensure enumerable methods
        d.enumerable = true
      }
      return d || Object.getOwnPropertyDescriptor(state, key)
    }
  })

  // bind actions now that proxy exists
  if (def.actions) {
    for (const name of Object.keys(def.actions)) {
      target[name] = (target[name] as Function).bind(proxy)
    }
  }

  return proxy
}

/**
 * defineStore('id', { state, getters, actions })
 * returns useStore() that singletons by id
 */
export function defineStore(id: string, def: StoreDef) {
  return function useStore() {
    let inst = __stores.get(id)
    if (!inst) {
      inst = makeStoreObject(id, def)
      __stores.set(id, inst)
    }
    return inst
  }
}

export function getStore(id: string) {
  return __stores.get(id)
}

export function storeRegistry() {
  return __stores
}
