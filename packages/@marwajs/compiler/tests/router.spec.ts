import { describe, it, beforeEach, afterEach, expect } from "vitest";
import {
  createRouter,
  defineRoutes,
  RouterView,
  RouterLink,
  useRoute,
  defineComponent,
  Dom,
  nextTick,
} from "@marwajs/core";

function textComponent(txt: string) {
  return defineComponent((_props) => {
    const el = Dom.createElement("div");
    Dom.setText(el, txt);
    return {
      mount(target: Node, anchor?: Node | null) {
        Dom.insert(el, target as Element, anchor ?? null);
      },
      destroy() {
        Dom.remove(el);
      },
    };
  });
}

describe("router: basic API", () => {
  beforeEach(() => {
    // clean URL each test
    window.history.replaceState({}, "", "/");
    (window as any).location.hash = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("defineRoutes keeps typing/shape", () => {
    const routes = defineRoutes([{ path: "/" }, { path: "/about" }]);
    expect(Array.isArray(routes)).toBe(true);
    expect(routes[0].path).toBe("/");
  });

  it("hash mode: initializes to '/' and updates with push/replace/back", async () => {
    const routes = defineRoutes([
      { path: "/" },
      { path: "/a" },
      { path: "/b" },
      { path: "*" },
    ]);

    const router = createRouter({ mode: "hash", routes });

    // init
    expect(window.location.hash).toBe("#/");
    expect(router.current.value.path).toBe("/");

    router.push("/a");
    await nextTick();
    expect(window.location.hash).toBe("#/a");
    expect(router.current.value.path).toBe("/a");

    router.replace("/b");
    await nextTick();
    expect(window.location.hash).toBe("#/b");
    expect(router.current.value.path).toBe("/b");

    router.back();
    await nextTick();
    // After replace("/b"), history is ["/", "/b"]. Back() -> "/".
    expect(window.location.hash).toBe("#/");
    expect(router.current.value.path).toBe("/");
  });

  it("params matching: /users/:id", () => {
    const routes = defineRoutes([{ path: "/users/:id" }, { path: "*" }]);
    const router = createRouter({ mode: "hash", routes });

    router.push("/users/42");
    expect(router.current.value.path).toBe("/users/42");
    expect(router.current.value.params.id).toBe("42");
  });
  it("history mode: respects base and updates pathname", async () => {
    window.history.replaceState({}, "", "/app/");
    const routes = defineRoutes([{ path: "/" }, { path: "/about" }]);

    const router = createRouter({ mode: "history", base: "/app", routes });

    expect(router.current.value.path).toBe("/");
    expect(window.location.pathname).toBe("/app/");

    router.push("/about");
    await nextTick();
    expect(router.current.value.path).toBe("/about");
    expect(window.location.pathname).toBe("/app/about");

    router.replace("/");
    await nextTick();
    expect(router.current.value.path).toBe("/");
    expect(window.location.pathname).toBe("/app/");
  });

  it("fallback '*' when no match", () => {
    const routes = defineRoutes([{ path: "/known" }, { path: "*" }]);
    const router = createRouter({ mode: "hash", routes });

    router.push("/nope");
    expect(router.current.value.path).toBe("/nope");
    expect(router.current.value.record?.path).toBe("*");
  });
});

describe("RouterView rendering", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    (window as any).location.hash = "";
    document.body.innerHTML = "";
  });

  it("renders sync components and swaps on navigation", async () => {
    const Home = textComponent("HOME");
    const About = textComponent("ABOUT");

    const router = createRouter({
      mode: "hash",
      routes: defineRoutes([
        { path: "/", component: Home },
        { path: "/about", component: About },
      ]),
    });

    const view = RouterView(router)({}, { app: {} as any });
    const host = document.createElement("div");
    view.mount(host);

    expect(host.textContent).toContain("HOME");

    router.push("/about");
    await nextTick();
    expect(host.textContent).toContain("ABOUT");

    router.push("/");
    await nextTick();
    expect(host.textContent).toContain("HOME");

    if (view.destroy) view.destroy();
  });

  it("supports async components (component() returns Promise)", async () => {
    const Async = () => Promise.resolve(textComponent("ASYNC"));

    const router = createRouter({
      mode: "hash",
      routes: defineRoutes([{ path: "/", component: Async }]),
    });

    const view = RouterView(router)({}, { app: {} as any });
    const host = document.createElement("div");
    view.mount(host);

    await nextTick();
    await nextTick();
    expect(host.textContent).toContain("ASYNC");
    if (view.destroy) view.destroy();
  });
});

describe("RouterLink helper", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    (window as any).location.hash = "";
    document.body.innerHTML = "";
  });

  it("creates <a> with hash-mode href and SPA navigation", async () => {
    const routes = defineRoutes([{ path: "/" }, { path: "/go" }]);
    const router = createRouter({ mode: "hash", routes });

    const a = RouterLink(router, "/go", { id: "go-link" });
    document.body.appendChild(a);

    expect((a as HTMLAnchorElement).getAttribute("href")).toBe("#/go");

    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);

    await nextTick();
    expect(router.current.value.path).toBe("/go");
    expect(window.location.hash).toBe("#/go");
  });

  it("useRoute returns same ref as router.current", () => {
    const routes = defineRoutes([{ path: "/" }]);
    const router = createRouter({ mode: "hash", routes });
    const r = useRoute(router);
    expect(r).toBe(router.current);
    router.push("/");
    expect(r.value.path).toBe("/");
  });
});
