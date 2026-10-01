// #1275: what a frame encodes for the pages the GPU draws itself (`freshPass.ts`): one compose,
// the pair cull's count, admission and cull (#1363) into the region cull's kept list, the count and
// cull dispatched by the arguments the compose wrote, one seal, then per pool layer one pass that
// clears the layer's pages and draws every kept pair — two indirect draws whatever the pages —,
// and the tinted layer's pass beside it while one is read; nothing in a frame with nothing new to
// draw, or while the GPU does not allocate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LAMP } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { LAYERS, frame } from './freshPass.fixture.ts';
import { FRESH_CASTERS, FRESH_CLEAR, freshDrawWord } from './freshLayout.ts';
import { keptPairs } from './pairRows.ts';

test('the GPU composes, counts, admits, culls and seals its pages, then draws each layer in two indirect draws', () => {
  const calls: unknown[][] = [],
    { lights, encode } = frame(calls);
  encode();
  const composed = ['data', 'state', 'drawList', 'freshFaces', 'freshVolumes', 'freshArgs'];
  const culled = ['spheres', 'freshParams', 'freshVolumes', 'vis 5', 'freshArgs', 'mobility'];
  culled.push('row lods');
  const dispatch = [(lights.pageRequests.allocation as Record<string, unknown>).freshDispatch, 0];
  assert.deepEqual(calls.slice(0, 6), [
    // The rows the cull tests — the table's, then the blended casters' —, the pairs it may keep.
    ['params', 4, LAYERS, 7, [9, 11], keptPairs(11)],
    ['compose', ...composed, 'freshParams', 'freshDispatch', 1],
    ['count', ...culled, dispatch],
    ['admit', ...culled, 1],
    ['cull', ...culled, dispatch],
    ['seal', ...composed, 'freshParams', 'freshDispatch', 1],
  ]);
  for (let layer = 0; layer < LAYERS; layer++) {
    const at = calls.findIndex((call) => call[0] === 'pass' && call[1] === `layer ${layer}`);
    assert.deepEqual(calls.slice(at + 1, at + 9), [
      ['group', 0, 'page group'],
      ['group', 1, 'face group'],
      ['group', 2, 'pool group'],
      ['pipeline', 'clear'],
      ['draw', 'freshArgs', 4 * freshDrawWord(layer, FRESH_CLEAR)],
      ['pipeline', 'casters'],
      ['draw', 'freshArgs', 4 * freshDrawWord(layer, FRESH_CASTERS)],
      ['end'],
    ]);
  }
  assert.equal(lights.shadowRenderPasses, LAYERS);
});

test("while a tinted layer is read, each layer's GPU pages are drawn into it too", () => {
  const calls: unknown[][] = [],
    { lights, encode } = frame(calls);
  lights.shadows.transmittance = { passes: ['tint 0', 'tint 1'].map((label) => ({ label })) };
  encode();
  for (let layer = 0; layer < LAYERS; layer++) {
    const at = calls.findIndex((call) => call[0] === 'pass' && call[1] === `tint ${layer}`);
    assert.ok(at > 0, `layer ${layer}: its tinted pass`);
    // The pool's opaque depth of that layer, then its pages cleared, then its blended casters.
    assert.deepEqual(calls[at + 3], ['group', 2, 'tint group']);
    const drawn = calls.slice(at, calls.indexOf(calls.slice(at).find((c) => c[0] === 'end')!));
    assert.deepEqual(
      drawn.filter((call) => call[0] === 'pipeline').map((call) => call[1]),
      ['tintClear', 'tintDepth', 'tintColour'],
    );
  }
  assert.equal(lights.shadowRenderPasses, 2 * LAYERS);
});

test('a frame with nothing new to draw encodes none of it; a move, a listed or a lost page does', () => {
  const calls: unknown[][] = [],
    { lights, encode } = frame(calls);
  lights.plan.gpu.moved = false;
  encode();
  assert.ok(calls.length > 0, 'the first frame the plan is seen runs');
  assert.equal(lights.plan.gpu.drewAt, 7, 'a frame that draws says so: its listings count (#1346)');
  lights.plan.gpu.drewAt = Infinity;
  const runs = (why: string) => {
    calls.length = 0;
    encode();
    assert.ok(
      calls.some((call) => call[0] === 'compose'),
      why,
    );
  };
  calls.length = 0;
  encode();
  assert.deepEqual(calls, [], 'nothing moved, nothing listed, nothing lost: nothing');
  assert.equal(lights.plan.gpu.drewAt, Infinity, 'nor says it drew');
  lights.plan.gpu.listed = 3;
  runs('a snapshot listed pages');
  lights.plan.gpu.listed = 0;
  lights.pageRequests.allocation.lost = 1;
  runs('the host took a page');
  lights.pageRequests.allocation.lost = 0;
  lights.store.add({ ...LAMP, id: 'new' });
  runs('a light was added');
  lights.plan.gpu.moved = true;
  runs('the view or a caster moved');
});

test('nothing is drawn by the GPU while it does not allocate', () => {
  const calls: unknown[][] = [],
    { lights, encode } = frame(calls);
  lights.plan.gpu.on = false;
  encode();
  assert.deepEqual(calls, []);
});
