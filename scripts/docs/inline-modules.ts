import { Worker } from 'node:worker_threads';
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
      // Each load gets a fresh module graph: cache-busting only the entry leaves its JSON
      // and helper imports stale in Node's process-wide ESM cache during docs:dev rebuilds.
      const worker = new Worker(new URL('./inline-worker.ts', import.meta.url), {
        workerData: path,
      });
      let contents: string;
      try {
        contents = await new Promise<string>((resolve, reject) => {
          worker.once('message', resolve);
          worker.once('error', reject);
          worker.once('exit', (code) =>
            reject(new Error(`Inline module exited without exports (${code}): ${path}`)),
          );
        });
      } finally {
        await worker.terminate();
      }
      return {
        contents,
        loader: 'js',
      };
    });
  },
};
