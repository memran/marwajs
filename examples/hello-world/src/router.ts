import { createRouter, defineRoutes } from "@marwajs/core";

export const router = createRouter({
  mode: "hash",
  routes: defineRoutes([
    { path: "/", component: () => import("./pages/Home.marwa") },
    { path: "/about", component: () => import("./pages/About.marwa") },
    { path: "*", component: () => import("./pages/NotFound.marwa") },
  ]),
});
