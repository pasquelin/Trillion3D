// A light cut's frame lists each caster once, however many views and batches want it, at the best
// request any of them made (#525): the list, as long as the catalogue, never fills with repeats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lightCutFrame } from './lightCutFrame.fixture.ts';
import { DAG_RELEVE_WGSL } from './shader/snapshotWgsl.ts';
import { DAG_VIEWS_WGSL } from './shader/viewsWgsl.ts';
import { dagWorkLayout } from './shader/floorWgsl.ts';
import { ASKED_PRIORITY_BITS, ASKED_STAMP_MAX, createAskedStamp } from './askedStamp.ts';
import { REQUEST_PRIORITY_MAX } from './request.ts';

test('a light cut lists a caster once a frame, at its best request: the contract restated here', () => {
  for (const line of [
    'let stamp=atomicLoad(&work[askedStamp()]);',
    'if((atomicMax(&work[askedWord(page)],(stamp<<ASKED_BITS)|(priority+1u))>>ASKED_BITS)==stamp){return;}',
    'let s=id.x;if(s>=min(atomicLoad(&out.count),views[0u].listCap)){return;}',
    'out.pages[s]=packRequest(page,(atomicLoad(&work[askedWord(page)])&((1u<<ASKED_BITS)-1u))-1u);',
    `const ASKED_BITS:u32=${ASKED_PRIORITY_BITS}u;`,
  ])
    assert.ok(DAG_RELEVE_WGSL.includes(line), line);
  // The stamp the host writes and the words a wrap clears are the kernel's: behind `drawnGroupsMax`.
  for (const line of [
    'fn askedStamp()->u32{return drawnGroupsMax()+1u;}',
    'fn askedWord(page:u32)->u32{return drawnGroupsMax()+2u+page;}',
  ])
    assert.ok(DAG_VIEWS_WGSL.includes(line), line);
  const layout = dagWorkLayout(3, 5, 7);
  assert.equal(layout.askedAt, layout.drawnGroupsMax + 1);
  assert.equal(layout.words, layout.askedAt + 1 + 7);
});

// Every sun level of every batch wants the casters that span the scene. Asked once a frame, they
// leave the list, as long as the catalogue, room for each batch's own casters: asked for, and never
// drawn again at once for want of a place in it (#525).
test("a caster every batch wants is asked for once a frame, and each batch's own casters too", async () => {
  const { cut, frame } = lightCutFrame();
  const pages = [4, 5, 6, 7, 8, 9, 10, 11];
  for (const run of ['a frame', 'the next frame']) {
    await frame(pages, new Set(), (page) => [0, 1, 2, 3, page].map((caster) => [caster, 1]));
    const asked = cut.reports.takeRequests()?.sort((a, b) => a - b);
    assert.deepEqual(asked, [0, 1, 2, 3, ...pages], `${run}: every caster, each once`);
    const now: number[] = [];
    cut.redraws.takeRedraw((page) => now.push(page));
    assert.deepEqual(now, [], `${run}: no coarse page drawn again at once`);
  }
});

// Two captures of one pose must ask in the same order (`lightCutReports.ts`): a caster listed by a
// coarse view that a later, finer view needs more is asked at the finer view's priority.
test('a caster several views ask for is asked at the highest priority any of them gives it', async () => {
  const { cut, frame } = lightCutFrame();
  await frame([4, 5], new Set(), (page) =>
    page === 4
      ? [
          [3, 2],
          [9, 5],
        ]
      : [[3, 8]],
  );
  assert.deepEqual(cut.reports.takeRequests(), [3, 9], 'caster 3 at 8, above caster 9 at 5');
});

// Page zero at priority zero packs to the word zero: the frame's mark is its priority plus one, so
// that request too is listed once, not once per view that wants it.
test('page zero at priority zero is listed once a frame too', async () => {
  const { cut, frame } = lightCutFrame();
  await frame([4, 5, 6], new Set(), () => [[0, 0]]);
  assert.deepEqual(cut.reports.takeRequests(), [0], 'page zero, once');
});

// A frame's asks are told from the last frame's by the stamp alone: nothing clears the words between
// two frames, and a word the last frame left, even at a higher priority, loses to this frame's (#525).
test("a frame's asks do not see the previous frame's, with no clear between them", async () => {
  const { cut, frame, words, askedAt } = lightCutFrame();
  await frame([4], new Set(), () => [[3, 9]]);
  cut.reports.takeRequests();
  const left = words()[askedAt + 1 + 3];
  assert.ok(left !== 0, 'the first frame left its word');
  await frame([4], new Set(), () => [[3, 2]]);
  assert.deepEqual(cut.reports.takeRequests(), [3], 'asked again, the next frame');
  assert.equal(words()[askedAt + 1 + 3] & ((1 << ASKED_PRIORITY_BITS) - 1), 3, 'at its own best');
});

// The stamp counts frames up to its last value, then starts again: that frame alone clears the
// words, once, since a word may still hold a larger stamp from before (`askedStamp.ts`).
test('the stamp wraps once every ASKED_STAMP_MAX frames, and only the wrap clears the words', () => {
  const asked = createAskedStamp();
  let clears = 0,
    last = 0;
  for (let frame = 0; frame < ASKED_STAMP_MAX + 3; frame++) {
    const { stamp, clear } = asked.next();
    if (clear) clears++;
    assert.ok(clear ? stamp === 1 && last === ASKED_STAMP_MAX : stamp === last + 1);
    last = stamp;
  }
  assert.equal(clears, 1);
  const marks = 2 ** ASKED_PRIORITY_BITS;
  assert.equal(ASKED_STAMP_MAX * marks + marks - 1, 0xffffffff, 'the largest stamp fills the word');
  assert.ok(REQUEST_PRIORITY_MAX + 1 < marks, 'every priority plus one fits below the stamp');
});
