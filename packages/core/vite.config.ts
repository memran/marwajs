import { defineConfig } from 'vite';
import marwaSfc from './plugins/vite-plugin-marwa'


export default defineConfig({
plugins: [marwaSfc()],
server: { port: 5173 },
});