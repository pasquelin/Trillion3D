// The plain light-tile pass — what a device without `subgroups` runs — builds on a real GPU the
// lists the subgroup pass builds (#924): two devices of one adapter, one granted `subgroups` and
// one not, the engine's pass on each, the same depth, lights and view, the narrow pass and the
// wide one with its pool (`lightTilesPlainPage.ts`); and the light grid each pass writes names
// every light that reaches a pixel of its slice (#1249).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import { dansPageWebgpu, bundlePage } from './pageWebgpu.ts';
import type { run } from './lightTilesPlainPage.ts';

declare global {
  var lightTilesPlain: { run: typeof run };
}

if (import.meta.main) {
  const here = dirname(fileURLToPath(import.meta.url));

  test('the plain tile pass keeps the lists of the subgroup pass, on the GPU', async () => {
    const script = await bundlePage(resolve(here, 'lightTilesPlainPage.ts'), 'lightTilesPlain');
    const pageErrors: string[] = [];
    const result = await dansPageWebgpu(
      (counts: number[]) => globalThis.lightTilesPlain.run(counts),
      [48, 800],
      { titre: 'Plain light tiles', script, erreursPage: pageErrors },
    );
    assert.equal(result.unavailable, undefined, 'WebGPU with subgroups must be available');
    assert.deepEqual([...(result.errors ?? []), ...pageErrors], []);
    const { runs } = result as Exclude<typeof result, { unavailable: string }>;
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
      // The pass's light grid (#1249): no light that reaches a pixel is left out of its slice, and
      // the slices walk fewer lights than the lists.
      for (const { grid } of [subgroup, plain]) {
        assert.equal(grid.missed, 0, `${count} lights: a reaching light left out of its slice`);
        assert.ok(grid.walked < grid.listed, `${count} lights: ${grid.walked} of ${grid.listed}`);
      }
    }
  });
}
