import type { Plugin } from 'esbuild';

/**
 * The lesson runtimes import the browser SDK by its source entry, `packages/sdk-browser/index.ts`,
 * so the type checker sees the engine's own types. In the built portal that import stays external
 * and resolves to `./engine.js`, the runtime bundle beside `portal.js`; in the server-rendered
 * component tests it stays external too, so no test bundles the engine it never mounts.
 */
export const externalEngine: Plugin = {
  name: 'external-engine',
  setup(bundler) {
    bundler.onResolve({ filter: /packages\/sdk-browser\/index\.ts$/ }, () => ({
      path: './engine.js',
      external: true,
    }));
  },
};
