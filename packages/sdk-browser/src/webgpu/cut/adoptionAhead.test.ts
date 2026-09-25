// The view ahead's requests reach their tier with each new readback, and only then (#488): a moving
// camera's readback names them, a stopped camera's names none, and a held readback repeats nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fixturePages,
  fixtureTotals,
  fixtureUniforms,
  mountCutAdopter,
  peekOnly,
} from './adopter.fixture.ts';
import type { GpuCut } from '../../gpu/core/selection.ts';

const readback = (ids: number[], ahead: number[]) =>
  ({
    uniforms: fixtureUniforms(),
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
  const { adopter, desired } = mountCutAdopter({
    packedPages: fixturePages(6),
    uniforms: fixtureUniforms(),
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
  peeked = readback([0, 1, 2], []);
  adopter.adopt();
  assert.deepEqual(offered.at(-1), [], 'the stopped camera asks for nothing ahead');
});
