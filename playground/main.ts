// main.ts
import { createApp,FormPlugin,RouterPlugin } from '@marwajs/core'; // whatever your app entry is called
import App from './App.marwa';

const routes = [
  { path: '/', name: 'home', component: 'Home' }, // string → runtime mount
  { path: '/about', name: 'about', component: () => import('./components/about.marwa') }, // lazy → await → string → runtime mount
 
];


const app = createApp(App);
await app.use(FormPlugin);
await app.use(RouterPlugin({
    routes,
    mode: 'history',              // or 'history' or hash
    base: '/',                 // only for 'history'
    interceptLinks: true,      // global <a data-router-link>
    // Optional: custom renderer if you want full control:
    // viewRenderer: async (host, route, app) => { ... }
  }));
app.mount('#app');