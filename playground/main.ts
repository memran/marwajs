import { createApp, createRouter, MarwaDevtools, createStore } from '@marwajs/core';

const app = createApp();

// simple global store
const user = createStore({ name: 'Marwa', age: 1 }, { immutable: true });
app.provide('user', user);

// devtools (Ctrl+Shift+D)
app.use(MarwaDevtools());

// pages/components are optional; router will hint if neither pages nor routes are present
// const files = (import.meta as any).glob?.('/pages/**/*.marwa') ?? {};
// const hasPages = Object.keys(files).length > 0;
// const routes = hasPages ? undefined : [{ path: '/', component: () => import('./App.marwa') }];

//app.use(createRouter({ files, routes }));

app.mount('#app');
