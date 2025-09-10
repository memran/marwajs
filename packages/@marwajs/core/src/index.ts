export { ref, isRef, unref } from "./reactivity/ref";
export { reactive, isReactive, toRaw } from "./reactivity/reactive";
export { computed } from "./reactivity/computed";
export { effect, stop, untrack } from "./reactivity/effect";
export { nextTick, flushJobs } from "./scheduler";

export {
  defineComponent,
  onMount,
  onDestroy,
  provide,
  inject,
  type ComponentSetup,
  type ComponentHooks,
  type ComponentContext,
} from "./runtime/component";

export { createApp, type App } from "./runtime/app";
export * as Dom from "./runtime/dom";

export {
  bindText,
  bindHTML,
  bindShow,
  bindClass,
  bindStyle,
  bindModel,
  on as onEvent,
  withModifiers, // NEW: event modifiers wrapper
  type ModelOptions,
} from "./runtime/directives";

export {
  bindFor, // NEW: keyed list helper for :for
  type Block,
} from "./runtime/list";

// Router MVP
export {
  createRouter,
  defineRoutes,
  RouterView,
  RouterLink,
  useRoute,
  type Router,
  type RouteRecord,
  type RouteMatch,
} from "./router";
