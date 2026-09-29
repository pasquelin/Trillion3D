// CPU-14 on the rows path: a placement row that moves stales the temporal pyramid where its root
// stood and stands, as a named move does (`../webgpu/pages/render/movedRegion.test.ts`), and a row
// written again at the same pose stales nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placedSession } from './webgpuGrowth.fixture.ts';
import { updateWebgpuPlacements } from './webgpuPlacements.ts';
import type { TemporalHizState } from '../hiz/hiz.ts';

test('a moved placement row stales its motion box, and keeps the pyramid', async () => {
  const session = await placedSession(5);
  const { rt, links } = session;
  try {
    const history = rt.run.temporalHizState;
    const pyramid = {} as NonNullable<TemporalHizState['pyramid']>;
    history.pyramid = pyramid;
    history.stale = [];
    const rows = links[0].placements!;
    updateWebgpuPlacements(rt, rows, 0, 0);
    assert.equal(history.stale.length, 0, 'the same pose: nothing staled');
    rows.matrices[12] += 3;
    updateWebgpuPlacements(rt, rows, 0, 0);
    assert.equal(history.pyramid, pyramid, 'the pyramid is kept');
    assert.equal(history.stale.length, 1);
    const [{ min, max }] = history.stale;
    assert.ok(max[0] - min[0] >= 3, 'the box spans where the root was and is');
  } finally {
    session.dispose();
  }
});
