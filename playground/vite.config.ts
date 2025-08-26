import path from 'node:path';
import { defineConfig } from 'vite';
import marwaSfc from '../packages/core/plugins/vite-plugin-marwa' 

export default defineConfig({
  root: __dirname,
  plugins: [marwaSfc('./App.marwa')],
  resolve: {
    alias: {
      '@marwajs/core': path.resolve(__dirname, '../packages/core/src/marwa')
    }
  }
});