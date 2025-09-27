import { createApp } from "@marwajs/core";
// @ts-ignore
import App from "./App.marwa";

const host = document.getElementById("app")!;
const app = createApp(host);

const comp = App({}, { app });
comp.mount(host);
