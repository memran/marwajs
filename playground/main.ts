//@ts-ignore
import { createApp,FormPlugin,RouterPlugin } from '@marwajs/core'; // whatever your app entry is called
import App from './App.marwa';

const routes = [
  { path: '/', component: 'Home' },      // maps to ./components/Home.marwa
  { path: '/about', component: 'About' } // maps to ./components/About.marwa
];


const app = createApp(App);
await app.use(FormPlugin);
await app.use(RouterPlugin({
    routes,
    mode: 'history',              // or 'history' or hash
    base: '/',                 // only for 'history'
    interceptLinks: true,      // global <a data-router-link>
    // Optional: custom renderer if you want full control:
    // viewRenderer: (host, route) => {
    //     host.innerHTML = `<h3>${route.path}</h3><small>${Date.now()}</small>`;
    // }
  }));
app.mount('#app');

const router = app.inject('router');
console.log('[check] router.current', router.current);
console.log('[check] has _render', typeof router._render);
console.log('[check] app._components', Object.keys((app as any)._components || {}));
