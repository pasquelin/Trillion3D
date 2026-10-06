// The WebGPU fallback pass, put on screen (#584). The fallback pass draws only when the device
// cannot build the visibility buffer, and no public option reaches that state. The page
// (`fallbackBlendPage.ts`) mounts the real engine twice on one scene: on the device as it is, then
// while the same device refuses the visibility target's pipelines. It fails when the second side
// did not fall back, when its only failure is not the refusal it caused, or when a tile of a
// blending mode is missing from its image — the mode the pass once dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { runPageProof, type PageProofResult } from '../kit/enginePageProof.ts';

type Reading = {
  fellBack: boolean;
  background: Record<string, number[]>;
  tiles: Array<{ mode: string } & Record<string, number[]>>;
};

interface Result extends PageProofResult {
  main?: Reading;
  fallback?: Reading;
}

/** Two colours farther apart than an 8-bit rounding on some channel. */
const differs = (a: number[], b: number[]) => a.some((value, i) => Math.abs(value - b[i]) > 8);

test('the fallback pass draws every blending mode once the visibility buffer is refused', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'fallbackBlendPage.ts'),
    'fallbackBlend',
    'run',
  )) as Result;
  assert.equal(result.indisponible ?? null, null, String(result.indisponible));
  assert.equal(result.erreur ?? null, null, String(result.erreur));
  assert.deepEqual(result.erreurs, []);
  const { main, fallback } = result;
  assert.ok(main && fallback, 'both images read');
  assert.equal(main.fellBack, false, 'the main side kept its visibility buffer');
  assert.equal(fallback.fellBack, true, 'the refusing side fell back');
  // The one failure the fallback side is built to cause; any other says the engine went wrong.
  const failures = (result.evenements ?? []).filter((e) => /failed/.test(e.phase));
  assert.ok(
    failures.every((e) => e.phase === 'material-pipeline-failed'),
    JSON.stringify(failures),
  );
  for (const tile of fallback.tiles)
    assert.ok(
      Object.keys(fallback.background).some((half) =>
        differs(tile[half], fallback.background[half]),
      ),
      `${tile.mode}: the fallback image does not show the tile`,
    );
});
