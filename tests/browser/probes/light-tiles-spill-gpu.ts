// The tile compaction's WGSL itself — the batched walk, the pool's spill and its overflow, the
// narrow pass's one batch — run on a real GPU against its TypeScript oracle
// (`bench/oracles/browser/gpuLightTilesRankOracle.ts`: a line-by-line port of the wide pass, whose
// batched walk gives the narrow pass's lists too), word for word: the tile record, the pool's
// words and the pool's state (#849) — and the count of slice tests: a one-batch scene past its
// list writes its pool slices from the masks it holds, never testing a light twice. The masks are
// the cases': the slice test is the harness's (`lightTilesSpillHarness.ts`), the rest is the
// shipped `compactWgsl.ts`.
//
//   node --experimental-strip-types --test tests/browser/probes/light-tiles-spill-gpu.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactTile, tileLayout } from '../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';
import { seeded } from '../../../site/examples/kit/random.ts';
import { dansPageWebgpu, bundlePage } from './pageWebgpu.ts';
import { spillHarness, type SpillCase } from './lightTilesSpillHarness.ts';
import type { run } from './lightTilesSpillPage.ts';
import {
  LIGHT_TILES_NARROW_SHADER,
  LIGHT_TILES_SHADER,
} from '../../../packages/sdk-browser/src/gpu/core/shaderTexts.fixture.ts';

declare global {
  var lightTilesSpill: { run: typeof run };
}

if (import.meta.main) {
  const here = dirname(fileURLToPath(import.meta.url));
  // The mask widths the pass ships: the wide pass's batch, the narrow pass's list.
  const WIDE = tileLayout(LIGHT_TILES_SHADER).words;
  const NARROW = tileLayout(LIGHT_TILES_NARROW_SHADER).words;
  const LIST = tileLayout(LIGHT_TILES_SHADER).tileLights;
  // Light 0 carries a shadow slot (`lightTilesSpillPage.ts`): a record whose opaque slice keeps
  // it must set the flag word, one that does not must leave it zero (#1249).
  const SHADOWED = [0];

  type Reach = (light: number) => boolean;
  /** A case of `count` lights, the opaque slice keeping `opaque`, the blend one `blend`. */
  function spillCase(
    name: string,
    count: number,
    opaque: Reach,
    blend: Reach,
    { capacity = 2 * count, head = 0, narrow = false } = {},
  ): SpillCase {
    const keeps = Array.from({ length: count }, (_, i) => +opaque(i) | (+blend(i) << 1));
    const words = narrow ? NARROW : WIDE;
    return { name, words, pool: !narrow, count, keeps, capacity: narrow ? 0 : capacity, head };
  }

  const all: Reach = () => true;
  const even: Reach = (i) => i % 2 === 0;
  const none: Reach = () => false;
  const r = seeded(849);
  const odds =
    (p: number): Reach =>
    () =>
      r() < p;
  // prettier-ignore
  const CASES = [
  spillCase('narrow, no light', 0, all, all, { narrow: true }),
  spillCase('narrow, one light', 1, all, none, { narrow: true }),
  spillCase('narrow, holey masks across a word', 33, even, (i) => i % 3 !== 0, { narrow: true }),
  spillCase('narrow, a full list', LIST, all, all, { narrow: true }),
  spillCase('wide, within the lists', 100, (i) => i % 3 === 0, (i) => i % 5 === 0),
  spillCase('wide, one light past a list', LIST + 1, all, (i) => i < LIST),
  spillCase('one batch, both slices past a list', 200, (i) => i % 3 !== 0, (i) => i % 3 === 0),
  spillCase('a full batch', 256, all, (i) => i % 2 === 1),
  spillCase('two batches', 257, all, (i) => i > 100),
  spillCase('three batches', 600, (i) => i % 4 === 1, (i) => i % 9 === 0 && i < 9 * LIST),
  spillCase('pool full for the blend slice', 300, even, (i) => i < 100, { capacity: 150 }),
  spillCase('one batch, pool too small', 200, all, all, { capacity: 100 }),
  spillCase('no pool', 300, even, (i) => i < 100, { capacity: 0 }),
  spillCase('a worn pool head', 300, all, all, { capacity: 1000, head: 0x80000000 }),
  ...Array.from({ length: 8 }, (_, k) => {
    const count = 1 + Math.floor(r() * 600);
    return spillCase(`random ${k}`, count, odds(0.1 + r() * 0.5), odds(r() * 0.5));
  }),
];

  test('the tile compaction WGSL writes the oracle’s lists, pool and overflow, on the GPU', async () => {
    const script = await bundlePage(resolve(here, 'lightTilesSpillPage.ts'), 'lightTilesSpill');
    const pageErrors: string[] = [];
    const result = await dansPageWebgpu(
      (cases: SpillCase[]) => globalThis.lightTilesSpill.run(cases),
      CASES,
      { titre: 'Light tile spill', script, erreursPage: pageErrors },
    );
    assert.equal(result.unavailable, undefined, 'WebGPU must be available');
    const { errors, runs } = result as Exclude<typeof result, { unavailable: string }>;
    assert.deepEqual([...errors, ...pageErrors], []);
    assert.equal(runs.length, CASES.length, 'every case ran');
    let spilled = 0,
      oneBatchSpills = 0,
      overflowed = 0,
      flagged = 0;
    for (const [k, c] of CASES.entries()) {
      const layout = tileLayout(spillHarness(c.words, c.pool));
      const keeps = (bit: number) => c.keeps.flatMap((keep, i) => (keep & bit ? [i] : []));
      const pool = { capacity: c.capacity, head: c.head, overflow: 0 };
      const tiles = compactTile(
        layout,
        { opaque: keeps(1), blend: keeps(2), shadowed: SHADOWED },
        c.count,
        undefined,
        pool,
      );
      assert.deepEqual(runs[k].tiles, [...tiles], `${c.name}: the record and the pool's words`);
      flagged += +(runs[k].tiles[layout.shadowBase] === 1);
      if (c.pool)
        assert.deepEqual(
          runs[k].pool,
          [layout.stride, c.capacity, pool.head, pool.overflow],
          `${c.name}: the pool's state`,
        );
      // Each light is tested once; a second walk only past a list in a scene of more batches.
      const past = Math.max(tiles[0], tiles[1]) > LIST;
      const walks = past && c.count > 32 * WIDE ? 2 : 1;
      assert.equal(runs[k].tested, walks * c.count, `${c.name}: slice tests`);
      spilled += +past;
      oneBatchSpills += +(past && walks === 1);
      overflowed += pool.overflow;
    }
    // The cases reach what they are for: slices in the pool, some written from the masks of one
    // batch, and pools with no room.
    assert.ok(
      spilled >= 8 && oneBatchSpills >= 3 && overflowed >= 4,
      `${spilled} spilled, ${oneBatchSpills} from the masks, ${overflowed} overflowed`,
    );
    // The flag word is exercised both ways: light 0 sets it where the opaque slice keeps it.
    assert.ok(
      flagged >= 1 && flagged < CASES.length,
      `${flagged} of ${CASES.length} records flagged their shadowed light`,
    );
  });
}
