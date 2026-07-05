// Constants live in shared/constants.mjs so the serverless SSR functions
// (api/render.js, api/sitemap.js) can use the same definitions. This
// re-export keeps every existing `import ... from "./constants.js"` working.
export * from "../shared/constants.mjs";
