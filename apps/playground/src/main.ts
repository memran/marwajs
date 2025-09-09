import { createApp, createRouter, defineRoutes,Plugin } from '@marwajs/core';

const routes = defineRoutes([
  { path: '/',      loader: () => import('./pages/Index.marwa'),
    layouts: [ () => import('./layouts/BaseLayout.marwa') ] },

  { path: '/about',    loader: () => import('./pages/About.marwa'),
    layouts: [ () => import('./layouts/BaseLayout.marwa') ] },

  { path: '/settings', loader: () => import('./pages/Settings.marwa'),
    layouts: [ () => import('./layouts/BaseLayout.marwa') ] },

  { path: '/feature',  loader: () => import('./pages/Feature.marwa'),
    layouts: [ () => import('./layouts/BaseLayout.marwa') ] },
  { path: '/login',  loader: () => import('./pages/Login.marwa'),
    layouts: [ () => import('./layouts/BaseLayout.marwa') ] },

  // keep last
  { path: '*', loader: () => import('./pages/404.marwa'),
    layouts: [ () => import('./layouts/BaseLayout.marwa') ],
    meta: { title: 'Not Found' }, notFound: true }
]);

const logger: Plugin = {
  name: 'logger',
  install(app) {
    console.log('Marwa plugin installed', app);
  }
};

createApp()
  //.use(logger)
  .use(createRouter({ routes, history: 'browser' }))
  .mount('#app'); // App.marwa auto-loaded by createApp if present
