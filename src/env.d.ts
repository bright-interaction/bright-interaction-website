/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_UMAMI_URL: string;
  readonly PUBLIC_UMAMI_WEBSITE_ID: string;
  readonly PUBLIC_GA4_MEASUREMENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
