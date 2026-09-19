import test from 'node:test';
import assert from 'node:assert/strict';
import { markDrawnDiverged, mirrorDrawnFromShown } from './webgpuPagesHelpers.ts';
import {
  fixturePages,
  fixtureUniforms,
  mountCutAdopter,
  peekOnly,
} from './webgpuCutAdopterFixture.ts';
import type { GpuCut } from './gpuSelection.ts';
import type { PageRec } from './pageSelection.ts';

// On the GPU path, `drawn` is only a copy of `shown`. Adoption remakes it when the shown list
// changes; the frame used to remake it unconditionally right after as well. A flag now says
// whether it is already in place, and these tests pin both sides: the helper that decides, and
// the adoption that raises it exactly when it has just copied.

const page = (i: number) => ({ url: `p${i}`, triangles: i + 1 }) as unknown as PageRec;

test('the copy happens only when the flag is down, and raises it', () => {
  const run = { shown: [page(0), page(1)], drawn: [] as PageRec[], drawnMirrorsShown: false };
  assert.equal(mirrorDrawnFromShown(run), true, 'the first frame copies');
  assert.deepEqual(run.drawn, run.shown);
  assert.equal(run.drawnMirrorsShown, true);

  // An intruder that only a rewrite would erase: the next turn must not touch it.
  const intrus = page(99);
  run.drawn.push(intrus);
  assert.equal(mirrorDrawnFromShown(run), false, 'flag up: nothing is redone');
  assert.equal(run.drawn.at(-1), intrus);

  // The CPU cut lowers the flag; the next frame copies the current `shown`.
  markDrawnDiverged(run);
  run.shown = [page(7)];
  assert.equal(mirrorDrawnFromShown(run), true);
  assert.deepEqual(
    run.drawn.map((rec) => rec.url),
    ['p7'],
  );
});

test('adoption announces the copy on a new shown list, never on the one it already holds', () => {
  const ids = [0, 1, 2, 3];
  const packedPages = fixturePages(ids.length);
  let annonces = 0;
  const premier: GpuCut = {
    uniforms: fixtureUniforms(),
    result: { pageIds: ids, drawablePageIds: ids, frustumRejected: 0, lodLevel: 0 },
  } as GpuCut;
  const second: GpuCut = {
    uniforms: fixtureUniforms(),
    result: { pageIds: [2, 0], drawablePageIds: [2, 0], frustumRejected: 0, lodLevel: 0 },
  } as GpuCut;
  let peeked: GpuCut | null = premier;
  const { adopter, shown, drawn } = mountCutAdopter({
    packedPages,
    residentOffsetWords: new Int32Array(packedPages.length),
    uniforms: fixtureUniforms(),
    selection: () => peekOnly(() => peeked),
    onDrawnMirrored: () => annonces++,
  });

  assert.equal(adopter.adopt(), true);
  assert.equal(annonces, 1, 'the first shown list copies and announces');
  assert.deepEqual(drawn, shown);

  assert.equal(adopter.adopt(), true);
  assert.equal(adopter.adopt(), true);
  assert.equal(annonces, 1, 'a shown list already held copies nothing, so announces nothing');

  peeked = second;
  assert.equal(adopter.adopt(), true);
  assert.equal(annonces, 2, 'a new shown list copies and announces again');
  assert.deepEqual(
    drawn.map((rec) => rec.url),
    ['p2', 'p0'],
  );
});
