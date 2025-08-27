// Minimal, focused typings matching MarwaJS runtime

export interface Ref<T> { value: T }
export declare function ref<T>(v: T): Ref<T>;
export declare function reactive<T extends object>(obj: T): T;
export declare function computed<T>(fn: () => T): Ref<T>;
export declare function effect(fn: () => void): () => void;

export type Scope = Record<string, any>;

export interface SetupContext {
  emit: (event: string, ...args: any[]) => void;
  provide: (key: any, value: any) => void;
  inject: <T = any>(key: any, fallback?: T) => T | undefined;
  parent: ComponentInstance | null;
  app: AppInstance;
}

export type SetupFn = (props: Record<string, any>, ctx: SetupContext) => Record<string, any>;
export interface ComponentOptions { template: string; setup: SetupFn }
export type Component = ComponentOptions;

export interface AppInstance {
  mount(el: string | Element, props?: Record<string, any>): ComponentInstance;
}

export interface ComponentInstance {
  el: Element;
  props: Record<string, any>;
  ctx: SetupContext;
  scope: Scope;
  provides: Record<any, any>;
  parent: ComponentInstance | null;
  app: AppInstance;
  unmount(): void;
}

export function defineComponent(options: ComponentOptions): Component;
export function createApp(root: Component): AppInstance;

export function provide(key: any, value: any): void;
export function inject<T = any>(key: any, fallback?: T): T | undefined;

// lazy component loader glue
export type ComponentModule = { default?: any };
export type ComponentLoader = (name: string) => Promise<ComponentModule | undefined>;
export function setComponentLoader(fn: ComponentLoader): void;
