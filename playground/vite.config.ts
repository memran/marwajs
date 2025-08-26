import { defineConfig } from 'vite';
import { MarwaSFC } from '@marwajs/core';

export default defineConfig({
  root: __dirname,
  plugins: [MarwaSFC()],
  server: { port: 5173 }
});
