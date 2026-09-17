import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare } from './index.mts';

/** Le vrai compilateur, là où `pnpm run build:native` le dépose. */
function compilerBinary() {
  const target = fileURLToPath(new URL('../asset-compiler-rust/target/', import.meta.url));
  return ['release', 'debug']
    .map((profile) => join(target, profile, 'web-geometry-compiler'))
    .find((path) => existsSync(path));
}
/** Un quadrilatère sur le disque : la plus petite source que le compilateur accepte. */
async function quad(root) {
  const source = join(root, 'quad.obj');
  await writeFile(source, 'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nvn 0 0 1\nf 1//1 2//1 4//1 3//1\n');
  return source;
}

// V02 : le manifeste est écrit avant la purge et ne peut donc pas porter la durée du travail ; le
// pointeur, lui, est rendu après. `prepare()` lisait le manifeste seul et perdait les deux mesures
// finales. Le parcours public complet, contre le vrai binaire, doit rendre les deux ensemble.
test('V02 prepare() rend les mesures finales du pointeur avec celles du manifeste', async (t) => {
  const executable = compilerBinary();
  if (!executable) return t.skip('compilateur natif absent : lancer `pnpm run build:native`');
  const root = await mkdtemp(join(tmpdir(), 'web-geometry-mesures-'));
  try {
    const result = await prepare(await quad(root), join(root, 'cache'), 'full', 150000, {
      executable,
      resourceBaseUrl: '/assets/',
    });
    const { importMs, compileMs, pruneMs, wallMs } = result.metrics;
    for (const [name, value] of Object.entries({ importMs, compileMs, pruneMs, wallMs }))
      assert.equal(typeof value, 'number', `${name} absente de ${JSON.stringify(result.metrics)}`);
    // La durée annoncée couvre la mise en forme du manifeste et la purge qui la suit.
    assert.ok(wallMs >= compileMs + pruneMs, `${wallMs} ms sous ${compileMs} + ${pruneMs} ms`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Un compilateur en toc : il dépose le manifeste demandé puis annonce le pointeur. Il fixe les deux
 * relevés, ce que le vrai binaire ne permet pas, et rend la règle de fusion observable.
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

test('le manifeste garde la priorité, le pointeur comble les mesures finales', async () => {
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
