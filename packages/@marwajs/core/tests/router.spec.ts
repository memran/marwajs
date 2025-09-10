import { describe, it, expect } from "vitest";
import { createApp, Dom, defineComponent, bindText, nextTick } from "../src";
import { createRouter, defineRoutes, RouterView, useRoute } from "../src";

const Home = defineComponent((_p, _ctx) => {
  let t!: Text;
  return {
    mount(target) {
      const p = Dom.createElement("p");
      t = Dom.createText("");
      Dom.insert(p, target);
      Dom.insert(t, p);
      bindText(t, () => "home");
    },
    destroy() {},
  };
});

const User = (router: ReturnType<typeof createRouter>) =>
  defineComponent((_p, _ctx) => {
    const route = useRoute(router);
    let t!: Text;
    return {
      mount(target) {
        const p = Dom.createElement("p");
        t = Dom.createText("");
        Dom.insert(p, target);
        Dom.insert(t, p);
        // reactive read of params
        bindText(t, () => `user:${route.value.params.id ?? ""}`);
      },
    };
  });

const NotFound = defineComponent((_p, _ctx) => {
  let t!: Text;
  return {
    mount(target) {
      const p = Dom.createElement("p");
      t = Dom.createText("");
      Dom.insert(p, target);
      Dom.insert(t, p);
      bindText(t, () => "notfound");
    },
  };
});

describe("router (hash mode)", () => {
  it("navigates, parses params, and renders RouterView", async () => {
    const host = document.createElement("div");
    const app = createApp(host);

    const routes = defineRoutes([
      { path: "/", component: () => Home },
      { path: "/users/:id", component: () => User(router) },
      { path: "*", component: () => NotFound },
    ]);

    const router = createRouter({ routes, mode: "hash" });

    const View = RouterView(router);
    const v = View({}, { app });
    v.mount(host);

    // initial
    await nextTick();
    expect(host.textContent).toContain("home");

    // go to user
    router.push("/users/42");
    await nextTick();
    expect(host.textContent).toContain("user:42");

    // unknown -> not found
    router.push("/nope");
    await nextTick();
    expect(host.textContent).toContain("notfound");

    // back goes to user
    router.back();
    // happy-dom fires pop/hash change synchronously or on next tick—wait once
    await nextTick();
    expect(host.textContent).toContain("user:42");

    // replace to home
    router.replace("/");
    await nextTick();
    expect(host.textContent).toContain("home");

    v.destroy();
  });
});
