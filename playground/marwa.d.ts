// marwa.d.ts or src/marwa.d.ts
declare module '*.marwa' {
  import { Component } from './marwa'; // Adjust path as needed
  const component: Component;
  export default component;
}