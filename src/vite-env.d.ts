/// <reference types="vite/client" />

declare var pendo: { trackAgent: (eventType: string, metadata: object) => void };

interface ImportMetaEnv {
  readonly VITE_WS_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
