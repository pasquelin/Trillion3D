// A repository page runs one engine (`repoServer`, #795), read without a browser: the served
// import map against what each page module served through `withRepoPage` imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { repositoryFiles } from '../../../scripts/repository-files.ts';
import { repoServer } from './repoPage.ts';

const ROOT = resolve(import.meta.dirname, '../../..');

/** Every page module a caller of `withRepoPage` names (`pageUrl`), from the repository root. */
const repoPages = () =>
  repositoryFiles()!
    .filter((file) => /^(bench|tests)\/.*\.ts$/.test(file))
    .map((file) => readFileSync(resolve(ROOT, file), 'utf8'))
    .filter((text) => text.includes('withRepoPage('))
    .flatMap((text) => [...text.matchAll(/pageUrl: '\/(tests\/[^']+)'/g)].map((match) => match[1]));

/** The repository page's import map, as the server sends it; a build older than a source still
 *  maps, so the unit suite does not ask for a rebuild after each edit. */
async function servedImports(): Promise<Record<string, string>> {
  const { server, port } = await repoServer(ROOT, { refuseStale: false });
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
  const pages = repoPages();
  assert.ok(pages.length >= 2, `the pages served by withRepoPage: ${pages.join(', ')}`);
  const [imports, ...importsOf] = await Promise.all([servedImports(), ...pages.map(imported)]);
  for (const [at, page] of pages.entries()) {
    const files = importsOf[at];
    // The node space whose second copy refused the proof's nodes is among them.
    assert.ok(files.includes('packages/sdk-core/src/world/object/objectSpace.ts'), page);
    // A fixture is not built: it runs from its source, once, on the emitted engine.
    const engine = files.filter(
      (file) => file.startsWith('packages/') && !/\.fixture\.ts$/.test(file),
    );
    for (const file of engine) {
      // Written out, not taken from the harness: the file the build emits for each source.
      const emitted = file.replace(/^packages\//, '/dist/').replace(/\.ts$/, '.js');
      assert.equal(
        imports[`/${file}`],
        emitted,
        `${page}: ${file} is not resolved to its dist file (a second engine, or a stale build)`,
      );
    }
  }
});
