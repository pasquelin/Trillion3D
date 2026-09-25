// A light cut's frame lists each caster once, however many views and batches want it, at the best
// request any of them made (#525): the list, as long as the catalogue, never fills with repeats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lightCutFrame } from './lightCutFrame.fixture.ts';
import { DAG_RELEVE_WGSL } from './shader/snapshotWgsl.ts';

test('a light cut lists a caster once a frame, at its best request: the contract restated here', () => {
  for (const line of [
    'if(isLightCut()&&atomicMax(&work[askedWord(page)],packRequest(page,priority))!=0u){return;}',
    'let s=id.x;if(s>=min(atomicLoad(&out.count),views[0u].listCap)){return;}',
    'out.pages[s]=atomicLoad(&work[askedWord(out.pages[s]&((1u<<PAGE_BITS)-1u))]);',
  ])
    assert.ok(DAG_RELEVE_WGSL.includes(line), line);
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
