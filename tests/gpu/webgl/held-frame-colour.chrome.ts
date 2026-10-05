// A held WebGL2 frame puts back the composed image byte for byte, in Chrome: on the engine's own
// surface (no alpha), unlit and lit, three held frames in a row show what the complete frame
// showed — the kept copy is never encoded or tone-mapped again — and draw nothing of the scene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { inChrome } from '../kit/onChrome.ts';
import type { execute } from './heldFrameColourPage.ts';

const PAGE = resolve(import.meta.dirname, 'heldFrameColourPage.ts');

test('a held WebGL2 frame shows the composed image unchanged', { timeout: 60_000 }, async () => {
  const result = await inChrome<ReturnType<typeof execute>>(PAGE, 'execute');
  console.log(JSON.stringify(result));
  assert.equal(result.alpha, false, 'the proof runs on the engine surface, without alpha');
  assert.equal(result.cases.length, 2, 'the unlit case and the lit case');
  for (const { lit, complete, held, draws, heldDraws } of result.cases) {
    const name = lit ? 'lit' : 'unlit';
    // Without a gap between its points the complete image could hide a re-encode.
    assert.ok(new Set(complete.map((px) => px.join(','))).size > 1, `${name}: one value only`);
    for (const [rank, image] of held.entries())
      assert.deepEqual(
        image,
        complete,
        `${name}: held image ${rank} differs from the complete one`,
      );
    assert.ok(draws > 0, `${name}: the complete image drew the scene`);
    assert.equal(heldDraws, draws, `${name}: a held image draws nothing of the scene`);
  }
});
