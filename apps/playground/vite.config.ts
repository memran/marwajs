import { defineConfig } from 'vite';
import marwa from '@marwajs/compiler/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
 resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  plugins: [marwa()],
});
