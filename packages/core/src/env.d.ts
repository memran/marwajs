/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly PROD: boolean;
  readonly DEV: boolean;
  // add your own env vars here
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}