import { defineConfig } from "vite";
import path from "node:path";
import { compileSFC } from "@marwajs/compiler";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  plugins: [
    {
      name: "marwa-compiler",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith(".marwa")) {
          const { code: out } = compileSFC(code, id);
          return { code: out, map: null };
        }
      },
    },
  ],
});
