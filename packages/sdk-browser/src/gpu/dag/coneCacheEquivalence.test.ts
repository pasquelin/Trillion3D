import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDagSelectionKernel } from './selection.ts';
import { PAGE_CONE_FLOATS } from '../core/selection.ts';
import { coldBase } from './layout.ts';
import { dagFixture, wideCamera } from '../../page/selection/dag.fixture.ts';
import { kernelUniforms, packed } from './selectionHelpers.fixture.ts';

// D5: shader/shader.ts now computes coneRejects once per visible page (dagWanted) and
// rereads it in dagEscalate/dagCheck/dagMask instead of recomputing. evaluateDagSelectionKernel
// carries both modes behind its 4th parameter `cacheCone` (oracle/oracle.ts): false recomputes
// at each site as before batch D5, true caches the first read (always that of the pageIds
// walk, the CPU equivalent of dagWanted) and rereads it afterwards, like the shader since D5.
// Both modes must produce exactly the same result.

function assertSameSelection(
  dag: ReturnType<typeof packed>['dag'],
  uniforms: ReturnType<typeof kernelUniforms>,
  resident?: Uint32Array,
) {
  const recomputed = evaluateDagSelectionKernel(dag, uniforms, resident, false);
  const cached = evaluateDagSelectionKernel(dag, uniforms, resident, true);
  assert.deepEqual(cached.pageIds, recomputed.pageIds, 'pageIds differ');
  assert.deepEqual(cached.drawablePageIds, recomputed.drawablePageIds, 'drawablePageIds differ');
  assert.equal(cached.frustumRejected, recomputed.frustumRejected);
  assert.equal(cached.lodLevel, recomputed.lodLevel);
  assert.equal(cached.complete, recomputed.complete);
  return recomputed;
}

test('normal scene: cache and recompute pick the same pages, several pixelError values', () => {
  const { dag, roots } = packed(dagFixture());
  const cam = wideCamera();
  for (const pixelError of [0, 1, 3.4, 20, 200]) {
    const uniforms = kernelUniforms(dag, roots, cam, pixelError, [1280, 720]);
    assertSameSelection(dag, uniforms);
  }
});

test('resident cut: cache and recompute escalate to the same missing pages', () => {
  const { dag, roots } = packed(dagFixture());
  const cam = wideCamera();
  const uniforms = kernelUniforms(dag, roots, cam, 1, [1280, 720]);
  const allMissing = new Uint32Array(dag.pageCount); // no resident page
  assertSameSelection(dag, uniforms, allMissing);
  const allResident = new Uint32Array(dag.pageCount).fill(1);
  assertSameSelection(dag, uniforms, allResident);
});

test('degenerate cone: hasBox is zero for every page, coneRejects always false', () => {
  const { dag, roots } = packed(dagFixture());
  const at = coldBase(dag.pageCount);
  for (let r = 0; r < dag.recordCount; r++) dag.pageCones[at + r * PAGE_CONE_FLOATS + 7] = 0;
  const cam = wideCamera();
  const uniforms = kernelUniforms(dag, roots, cam, 1, [1280, 720]);
  const result = assertSameSelection(dag, uniforms);
  // Without a cone box, coneRejects always returns false: no visible page is rejected by it.
  assert.ok(result.pageIds.length > 0);
});

test('camera far from everything: every page is outside the frustum, the cache stays empty', () => {
  const { dag, roots } = packed(dagFixture());
  const cam = wideCamera();
  cam.position.set(1e6, 0, 0);
  cam.lookAt(2e6, 0, 0);
  cam.updateMatrixWorld();
  const uniforms = kernelUniforms(dag, roots, cam, 1, [1280, 720]);
  const result = assertSameSelection(dag, uniforms, new Uint32Array(dag.pageCount));
  assert.equal(result.frustumRejected, dag.pageCount);
  assert.equal(result.pageIds.length, 0);
});
