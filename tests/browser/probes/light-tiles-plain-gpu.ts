// The plain light-tile pass — what a device without `subgroups` runs — builds on a real GPU the
// lists the subgroup pass builds (#924): two devices of one adapter, one granted `subgroups` and
// one not, the engine's pass on each, the same depth, lights and view, the narrow pass and the
// wide one with its pool (`lightTilesPlainPage.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import { dansPageWebgpu, empaquetePage } from './pageWebgpu.ts';
import type { executer } from './lightTilesPlainPage.ts';

declare global {
  var lightTilesPlain: { executer: typeof executer };
}

const ici = dirname(fileURLToPath(import.meta.url));

test('the plain tile pass keeps the lists of the subgroup pass, on the GPU', async () => {
  const script = await empaquetePage(resolve(ici, 'lightTilesPlainPage.ts'), 'lightTilesPlain');
  const erreursPage: string[] = [];
  const releve = await dansPageWebgpu(
    (counts: number[]) => globalThis.lightTilesPlain.executer(counts),
    [48, 800],
    { titre: 'Plain light tiles', script, erreursPage },
  );
  assert.equal(releve.indisponible, undefined, 'WebGPU with subgroups must be available');
  assert.deepEqual([...(releve.erreurs ?? []), ...erreursPage], []);
  const { runs } = releve as Exclude<typeof releve, { indisponible: string }>;
  for (const { count, subgroup, plain } of runs) {
    assert.deepEqual([subgroup.subgroups, plain.subgroups], [true, false], 'one variant each');
    const wide = count > LIGHT_SETTINGS.tileLights;
    assert.deepEqual([subgroup.wide, plain.wide], [wide, wide]);
    assert.deepEqual([subgroup.overflowed, plain.overflowed], [0, 0], 'every pool had room');
    const kept = subgroup.lists.map((list) => list.length);
    assert.ok(
      kept.some((n) => n > 0),
      'lists to compare',
    );
    if (wide) assert.ok(Math.max(...kept) > LIGHT_SETTINGS.tileLights, 'a slice in the pool');
    assert.deepEqual(plain.lists, subgroup.lists, `the same lists, ${count} lights`);
  }
});
