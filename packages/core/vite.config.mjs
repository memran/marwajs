import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/marwa/index.ts'),
      name: 'marwa',
      fileName: (format) => `marwa.${format}.js`,
      formats: ['es'],
    },
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      treeshake: true,
      external: [], // keep empty if you want a single-file ESM
    },
  },
  plugins: [
    dts({
      entryRoot: path.resolve(__dirname, 'src/marwa'),
      outDir: path.resolve(__dirname, 'dist'),
    }),
  ],
});
