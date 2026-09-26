// A repository page runs one engine (`repoServer`, #795), read without a browser: the served
// import map against what each page module served through `withRepoPage` imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { repoServer } from './repoPage.ts';

const ROOT = resolve(import.meta.dirname, '../../..');

/** The repository page's import map, as the server sends it. */
async function servedImports(): Promise<Record<string, string>> {
  const { server, port } = await repoServer(ROOT);
  try {
    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    const map = /<script type="importmap">(.*?)<\/script>/s.exec(page)![1];
    return JSON.parse(map).imports;
  } finally {
    server.close();
  }
}

/** Every repository file the page module `entry` imports, transitively (types left out). */
async function imported(entry: string) {
  const { metafile } = await build({
    absWorkingDir: ROOT,
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser',
    external: ['three', 'three/*', 'meshoptimizer'],
    logLevel: 'silent',
  });
  return Object.keys(metafile.inputs);
}

test('each repository page runs the engine it draws with, the one under dist/', async () => {
  const imports = await servedImports();
  for (const page of ['materialPixelsPage.ts', 'anisotropyCostPage.ts']) {
    const files = await imported(`tests/browser/support/${page}`);
    // The node space whose second copy refused the proof's nodes is among them.
    assert.ok(files.includes('packages/sdk-core/src/world/object/objectSpace.ts'), page);
    // A fixture is not built: it runs from its source, once, on the emitted engine.
    const engine = files.filter(
      (file) => file.startsWith('packages/') && !/\.fixture\.ts$/.test(file),
    );
    for (const file of engine) {
      // Written out, not taken from the harness: the file the build emits for each source.
      const emitted = file
        .replace(/^packages\//, '/dist/')
        .replace(/\.ts$/, '.js')
        .replace(/\.mts$/, '.mjs');
      assert.equal(
        imports[`/${file}`],
        emitted,
        `${page}: ${file} is not resolved to its dist file (a second engine, or a stale build)`,
      );
    }
  }
});
