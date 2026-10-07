// #1483: a pool short of the cut has the GPU rank the camera's requests by ADMISSION — the minimum
// capacity's pages, then the coarsest level, then the larger error —, in the request's nine bits;
// the host walks them as they come and sorts no list (`../../webgpu/residency/requestAdmission.ts`).
// The shipped kernel is held to the same order on a device (`tests/gpu/dag/admission-order.gpu.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { REQUEST_STEP_MAX } from './request.ts'
import { quantizeAdmission, quantizeRequestPriority } from './request.fixture.ts'
import { requestScene } from './requestScene.fixture.ts'
import { evaluateDagSelectionKernel } from './oracle/oracle.fixture.ts'
import { dagRecords, flagsOf } from './records.fixture.ts'
import { CLUSTER_LEVEL_SHIFT } from './clusterFlags.ts'
import { writeDagUniforms } from './uniforms.ts'
import { viewWord } from './viewLayout.ts'
import { DAG_UNIFORM_BYTES } from './shader/viewsWgsl.ts'
import { sameSelectionUniforms } from '../core/selectionCopy.ts'

test('an admission rank puts the floor first, then the coarser level, then the larger error', () => {
  const finest = quantizeAdmission(0, false, 1e6),
    coarse = quantizeAdmission(3, false, 0.1)
  assert.ok(coarse > finest, 'a coarser level whatever the errors')
  assert.ok(quantizeAdmission(0, true, 0) > quantizeAdmission(31, false, Infinity), 'the floor')
  assert.ok(quantizeAdmission(2, false, 64) > quantizeAdmission(2, false, 1), 'then the error')
  // Within the visible tier: every admission rank stays below the tier ahead's bit.
  assert.ok(quantizeAdmission(99, true, Infinity) <= REQUEST_STEP_MAX)
  assert.equal(quantizeRequestPriority(0), quantizeAdmission(0, false, 0))
})

test('the kernel publishes a short pool’s requests coarsest level first, the errors after', () => {
  const scene = requestScene(1, 1024, 6),
    records = dagRecords(scene.packed)
  const levelOf = (page: number) => flagsOf(records, page) >>> CLUSTER_LEVEL_SHIFT
  const byError = evaluateDagSelectionKernel(scene.packed, scene.uni)
  const byLevel = evaluateDagSelectionKernel(scene.packed, { ...scene.uni, admitByLevel: true })
  const levels = byLevel.pageIds.map(levelOf)
  assert.ok(new Set(levels).size > 2, 'the cut must span levels')
  for (let i = 1; i < levels.length; i++)
    assert.ok(levels[i] <= levels[i - 1], `rank ${i}: level ${levels[i]} after ${levels[i - 1]}`)
  // The same requests, ranked another way: the cut does not change, only its order.
  assert.deepEqual([...byLevel.pageIds].sort(), [...byError.pageIds].sort())
  assert.notDeepEqual(byLevel.pageIds, byError.pageIds)
})

test('the mode reaches the kernel in its word, and a change of it is another cut', () => {
  const scene = requestScene(1, 256, 4)
  const target = new Float32Array(DAG_UNIFORM_BYTES / 4),
    word = () => new Uint32Array(target.buffer)[viewWord('admitByLevel')]
  writeDagUniforms(target, scene.packed, { ...scene.uni, admitByLevel: true }, 16)
  assert.equal(word(), 1)
  writeDagUniforms(target, scene.packed, scene.uni, 16)
  assert.equal(word(), 0)
  assert.equal(sameSelectionUniforms(scene.uni, { ...scene.uni, admitByLevel: true }), false)
})
