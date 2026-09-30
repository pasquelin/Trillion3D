#!/usr/bin/env node
// `pnpm run check:bundle-size`: the gzip size of the CDN core against its budget, after `build`.
// The core is what a page downloads before its first frame: `dist/trillion3d.module.js` and every
// chunk it imports statically. A chunk it imports dynamically — an optional family — is fetched on
// first use and is not counted; neither are the workers and the WebAssembly modules.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { BUNDLE_ENTRY } from './build-bundle.ts';

/** The budget of the gzip core, in bytes: the core of #1353 (744 KB) and room for a few features.
 *  A declared value, not a derived one; a pull request that crosses it says why, and raises it. */
const CORE_BUDGET_BYTES = 800_000;

/** `from"./x.js"` and a bare `import"./x.js"`, as esbuild writes them, never `import("./x.js")`. */
const STATIC_IMPORT = /(?:\bfrom\s*|\bimport\s*)(["'])(\.\/[^"']+)\1/g;

/** The files of the core: `entry` and the chunks it imports statically, transitively. */
export function coreFiles(dist: string, entry = BUNDLE_ENTRY): string[] {
  const found = [entry];
  for (let at = 0; at < found.length; at++)
    for (const [, , path] of readFileSync(join(dist, found[at]), 'utf8').matchAll(STATIC_IMPORT)) {
      const name = path.slice(2);
      if (!found.includes(name)) found.push(name);
    }
  return found;
}

/** The core's gzip size, and the line the CI prints. */
export function coreSize(dist: string, budget = CORE_BUDGET_BYTES) {
  const files = coreFiles(dist);
  const bytes = files.reduce(
    (sum, name) => sum + gzipSync(readFileSync(join(dist, name)), { level: 9 }).length,
    0,
  );
  const verdict = bytes <= budget ? 'within' : 'OVER';
  return {
    bytes,
    fits: bytes <= budget,
    line: `CDN core: ${bytes} bytes gzip in ${files.length} files, ${verdict} its budget of ${budget}`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { fits, line } = coreSize(resolve('dist'));
  console.log(line);
  if (!fits) process.exit(1);
}
