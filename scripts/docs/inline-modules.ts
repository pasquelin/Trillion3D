import { pathToFileURL } from 'node:url';
import type { Plugin } from 'esbuild';

/**
 * A `.inline.ts` module of the site reads files at load — the languages of `site/i18n/` — so a
 * language is added by adding its file. The bundle
 * never ships that reading: this plugin runs the module at build time and bundles its exports as
 * the JSON they hold.
 */
export const inlineModules: Plugin = {
  name: 'inline-modules',
  setup(bundler) {
    bundler.onLoad({ filter: /\.inline\.ts$/ }, async ({ path }) => {
      // A fresh copy on every build, so a rebuild sees a file added since the last one.
      const exports: Record<string, unknown> = await import(
        `${pathToFileURL(path).href}?build=${Date.now()}`
      );
      return {
        contents: Object.entries(exports)
          .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`)
          .join('\n'),
        loader: 'js',
      };
    });
  },
};
