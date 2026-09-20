import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare } from './index.mts';

/** The real compiler, where `pnpm run build:native` drops it. */
function compilerBinary() {
  const target = fileURLToPath(new URL('../asset-compiler-rust/target/', import.meta.url));
  return ['release', 'debug']
    .map((profile) => join(target, profile, 'web-geometry-compiler'))
    .find((path) => existsSync(path));
}
/** A quad on disk: the smallest source the compiler accepts. */
async function quad(root) {
  const source = join(root, 'quad.obj');
  await writeFile(source, 'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nvn 0 0 1\nf 1//1 2//1 4//1 3//1\n');
  return source;
}

// V02: the manifest is written before the prune and therefore cannot carry the job duration; the
// pointer is returned after. `prepare()` used to read the manifest alone and lost the two final
// measurements. The full public path, against the real binary, must return both together.
test('V02 prepare() returns the pointer’s final measurements with the manifest’s', async (t) => {
  const executable = compilerBinary();
  if (!executable) return t.skip('native compiler missing: run `pnpm run build:native`');
  const root = await mkdtemp(join(tmpdir(), 'web-geometry-mesures-'));
  try {
    const result = await prepare(await quad(root), join(root, 'cache'), 'full', 150000, {
      executable,
      resourceBaseUrl: '/assets/',
    });
    const { importMs, compileMs, pruneMs, wallMs } = result.metrics;
    for (const [name, value] of Object.entries({ importMs, compileMs, pruneMs, wallMs }))
      assert.equal(
        typeof value,
        'number',
        `${name} missing from ${JSON.stringify(result.metrics)}`,
      );
    // The announced duration covers formatting the manifest and the prune that follows it.
    assert.ok(wallMs >= compileMs + pruneMs, `${wallMs} ms under ${compileMs} + ${pruneMs} ms`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// #47: the same source prepared twice into one cache finds its folder proven and kept; the
// result says so, and the hierarchy duration of a run that built none stays `null`.
test('prepare() reports the folder reused by a second identical run', async (t) => {
  const executable = compilerBinary();
  if (!executable) return t.skip('native compiler missing: run `pnpm run build:native`');
  const root = await mkdtemp(join(tmpdir(), 'web-geometry-reuse-'));
  try {
    const source = await quad(root);
    const options = { executable, resourceBaseUrl: '/assets/' };
    const first = await prepare(source, join(root, 'cache'), 'full', 150000, options);
    assert.equal(first.reused, null);
    const second = await prepare(source, join(root, 'cache'), 'full', 150000, options);
    assert.equal(second.key, first.key);
    assert.ok(second.reused.objects > 0, JSON.stringify(second.reused));
    assert.equal(typeof second.reused.validateMs, 'number');
    assert.equal(typeof second.metrics.wallMs, 'number');
    // The manifest on disk still says how long the first run clustered; this run did not.
    assert.equal(second.metrics.clusterHierarchyPagesMs, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * A stub compiler: it drops the requested manifest then announces the pointer. It pins both
 * readings, which the real binary cannot, and makes the merge rule observable.
 */
async function faux(root, manifeste, pointeur) {
  const chemin = join(root, 'faux-compilateur.mjs');
  await writeFile(
    chemin,
    `#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [, , , sortie, portee] = process.argv;
const pointeur = ${JSON.stringify(pointeur)};
await mkdir(join(sortie, 'native', portee), { recursive: true });
await writeFile(join(sortie, 'native', portee, pointeur.url), ${JSON.stringify(JSON.stringify(manifeste))});
process.stdout.write(JSON.stringify(pointeur));
`,
    { mode: 0o755 },
  );
  return chemin;
}

test('the manifest keeps priority, the pointer fills in the final measurements', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-geometry-fusion-'));
  try {
    const manifeste = { status: 'ready', metrics: { importMs: 1, compileMs: 2 } };
    const pointeur = {
      status: 'ready',
      scope: 'full',
      url: 'quad.json',
      pointer: 'quad',
      cache: 'c',
      metrics: { importMs: 999, wallMs: 40, pruneMs: 5 },
    };
    const result = await prepare(await quad(root), join(root, 'cache'), 'full', 150000, {
      executable: await faux(root, manifeste, pointeur),
      resourceBaseUrl: '/assets/',
    });
    assert.deepEqual(result.metrics, { importMs: 1, compileMs: 2, wallMs: 40, pruneMs: 5 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
