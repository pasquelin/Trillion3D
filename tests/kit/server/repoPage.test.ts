// A repository page runs one engine: every engine module its page modules import by relative
// path resolves, through the page's import map, to the file the engine loaded from `dist/` runs.
// Two instances would hold two scene states, and the material proof's nodes would refuse each
// other ("Scene nodes belong to different roots", #795). Read without a browser: the served
// import map against what the proof's page imports.
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

test('the material proof page runs the engine it draws with, the one under dist/', async () => {
  const imports = await servedImports();
  const files = await imported('tests/browser/support/materialPixelsPage.ts');
  const engine = files.filter((file) => file.startsWith('packages/'));
  // The node space whose second copy refused the proof's nodes is among them.
  assert.ok(engine.includes('packages/sdk-core/src/world/object/objectSpace.ts'));
  for (const file of engine) {
    // A fixture is not built: it runs from its source, once, on the emitted engine.
    if (file.endsWith('.fixture.ts')) continue;
    const emitted = file.replace(/^packages\//, '/dist/').replace(/\.ts$/, '.js');
    assert.equal(imports[`/${file}`], emitted, `${file} would run beside its dist twin`);
  }
});
