/**
 * The browser engine is loaded at run time from the built docs/runtime/engine.js next to the
 * portal: no bundle of the docs sources embeds it, and none needs it built to be bundled.
 */
export const externalEngine = {
  name: 'external-engine-runtime',
  setup(bundler) {
    bundler.onResolve({ filter: /runtime\/engine\.js$/ }, () => ({
      path: './engine.js',
      external: true,
    }));
  },
};
