// #489: the wait a frame publishes (`counts.waitedMs`, `shadowWaitMs`) is a wait someone had — the
// time a stale page was read and not yet drawn —, never the time since it went stale while no
// report named it. Frames are 16 ms apart (`planFrame`); a report is read one frame late.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleDrawn, planFrame, report, sunScene, VIEW } from './lightShadow.fixture.ts';
import { entriesOf, sunBlock } from './sunView.fixture.ts';

test('a page stale while no one read it has waited only from the frame it is read', () => {
  const { store, plan, slice } = sunScene();
  const named = entriesOf(plan, slice, sunBlock(plan, slice, [2, 3, 4], VIEW.position, 4));
  const read = () => named,
    none = () => [];
  for (let frame = 1; frame < 4; frame++) cycleDrawn(plan, store, frame, read);
  for (let frame = 4; frame < 6; frame++) cycleDrawn(plan, store, frame, none);
  // A static caster moves under the pages while no report names them: stale, withdrawn, unread.
  plan.worldChanged([-1, 0, -1], [1, 1, 1]);
  const staled = cycleDrawn(plan, store, 6, none);
  assert.ok(plan.counts.invalidatedPages > staled.size, 'pages went stale unread');
  for (let frame = 7; frame < 41; frame++) cycleDrawn(plan, store, frame, none);
  cycleDrawn(plan, store, 41, read);
  // Frame 42 reads the report of 41: its stale pages are read for the first time, and drawn.
  const listed = planFrame(plan, store, 42);
  assert.ok(listed > 0, 'the pages read are listed');
  assert.equal(plan.counts.waitedMs, 0, 'stale for 36 frames, read for none of them');
  // Its memory guard stops the frame at its first page: they are read, and left undrawn.
  plan.reissue(0);
  report(plan, store, 42, named);
  planFrame(plan, store, 43);
  assert.equal(plan.counts.waitedMs, 16, 'read one frame, not yet drawn');
  plan.commit();
  report(plan, store, 43, named);
  planFrame(plan, store, 44);
  assert.equal(plan.counts.waitedMs, 0, 'drawn: nothing waits');
});
