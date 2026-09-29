// The view ahead's requests reach their tier with each new readback, and only then (#488): a moving
// camera's readback names them, a still camera's names none, and a held readback repeats nothing.
// The view ahead changes no drawn page: once the camera stops, the last readback of the move — cut
// at the pose it stopped at — is the still camera's cut, adopted with no readback more.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fixturePages,
  fixtureTotals,
  fixtureUniforms,
  mountCutAdopter,
  peekOnly,
} from './adopter.fixture.ts';
import { sameSelectionUniforms, type GpuCut } from '../../gpu/core/selection.ts';
import type { AheadView } from '../../gpu/core/aheadView.ts';

const AHEAD: AheadView = { planes: new Float32Array(24).fill(1), view: new Float32Array(16) };
/** The uniforms of a camera at the fixture's pose, moving (a view ahead) or still. */
const posed = (moving: boolean) => ({ ...fixtureUniforms(), ahead: moving ? AHEAD : null });

const readback = (ids: number[], ahead: number[], moving = true) =>
  ({
    uniforms: posed(moving),
    result: {
      pageIds: ids,
      aheadPageIds: ahead,
      drawablePageIds: ids,
      frustumRejected: 0,
      lodLevel: 0,
      ...fixtureTotals(),
    },
  }) as GpuCut;

test('each new readback hands its requests ahead to their tier, an empty list once stopped', () => {
  const offered: number[][] = [];
  let peeked = readback([0, 1], [4, 5]);
  const uniforms = posed(true);
  const { adopter, desired } = mountCutAdopter({
    packedPages: fixturePages(6),
    uniforms,
    selection: () => peekOnly(() => peeked),
    onAhead: (ids) => offered.push([...ids]),
  });
  adopter.adopt();
  assert.deepEqual(offered, [[4, 5]]);
  assert.deepEqual(
    desired.map((page) => page.packedIndex),
    [0, 1],
    'what is ahead is never part of the camera cut',
  );
  adopter.adopt();
  assert.equal(offered.length, 1, 'a held readback offers nothing again');
  uniforms.ahead = null;
  peeked = readback([0, 1, 2], [], false);
  adopter.adopt();
  assert.deepEqual(offered.at(-1), [], 'the stopped camera asks for nothing ahead');
});

test('the last readback of a move is adopted once the camera stops, with no readback more', () => {
  const offered: number[][] = [];
  const last = readback([0, 1], [4, 5]),
    uniforms = posed(true);
  const { adopter } = mountCutAdopter({
    packedPages: fixturePages(6),
    uniforms,
    selection: () => peekOnly(() => last),
    onAhead: (ids) => offered.push([...ids]),
  });
  assert.equal(adopter.adopt(), true, 'adopted while moving');
  // The camera stops where the readback was cut: same pose, no view ahead.
  uniforms.ahead = null;
  assert.ok(sameSelectionUniforms(last.uniforms, uniforms), 'the dispatch asks no new readback');
  assert.equal(adopter.adopt(), true, 'the still camera shows the readback it holds');
  assert.equal(adopter.metrics.ready, true);
  assert.deepEqual(offered, [[4, 5], []], 'and its tier ahead empties, once');
  adopter.adopt();
  assert.equal(offered.length, 2);
});
