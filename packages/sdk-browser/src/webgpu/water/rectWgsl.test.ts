// The GPU water rectangle (`rectWgsl.ts`, `argsWgsl.ts`), its shipped text run in JavaScript
// (`shaderRun`, the `double.ts` contract), against the CPU walk and freeze it replaces
// (`waterRect.fixture.ts`), word for word (`rectKernel.fixture.ts`): the rectangle the pass covers,
// the backdrop copy and the gate, on the real collected water scene and its conservative fallbacks.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FLAG_CLUSTER_PAGE, FLAG_PAGED } from '../../visibility/types.ts'
import { buildBlendStatics, refreshBlendPlan } from '../blend/plan.ts'
import { uniformStride } from '../../residency/pools.ts'
import { WATER_RANK_SHIFT } from './rank.ts'
import { frame, scene } from './rectKernel.fixture.ts'
import { SIZE } from '../../../../../tests/gpu/water/waterCostScene.ts'

const full = [0, 0, ...SIZE]

test('real collect and prepare: the kept surface crops the pass, as the CPU did', () => {
  const { state, item, camera } = scene()
  assert.equal(item.flags & (FLAG_PAGED | FLAG_CLUSTER_PAGE), 0)
  const kept = frame(state, camera)
  assert.equal(kept.drawn, true)
  assert.ok(kept.rect[0] > 450 && kept.rect[2] < 830)
  assert.ok(kept.rect[1] > 250 && kept.rect[3] < 470)
  // A declared thickness widens the backdrop the copy freezes.
  state.volumePacked[2] = 0.5
  const thick = frame(state, camera)
  assert.ok(thick.copy[0] < kept.copy[0] && thick.copy[2] > kept.copy[2])
  // Out of the frustum: nothing draws, the gate closes, the CPU never knew.
  item.bounds = new Float64Array([100, 0, 0, 101, 1, 0])
  assert.equal(frame(state, camera).drawn, false)
  const parked = scene(false)
  assert.equal(frame(parked.state, parked.camera).drawn, false, 'parked tile')
})

test('unknown, nonfinite, near-plane, paged, non-affine and distant water keep full coverage', () => {
  for (const kind of ['unknown', 'nonfinite', 'near', 'quantized', 'skewed', 'distant', 'thick']) {
    const { state, item, camera } = scene()
    const elements = item.matrix.elements as number[]
    if (kind === 'unknown') item.bounds = undefined
    if (kind === 'nonfinite') item.bounds![0] = NaN
    if (kind === 'near') elements[14] = 2.95
    if (kind === 'quantized') item.flags |= FLAG_CLUSTER_PAGE
    if (kind === 'skewed') elements[3] = 1e-3
    if (kind === 'thick') state.volumePacked[2] = Infinity
    if (kind === 'distant') {
      elements[12] = elements[13] = 1e15
      camera.viewProjection[12] -= camera.viewProjection[0] * 1e15
      camera.viewProjection[13] -= camera.viewProjection[5] * 1e15
    }
    const drawn = frame(state, camera)
    if (kind !== 'thick' && drawn.drawn) assert.deepEqual(drawn.rect, full, kind)
    if (kind === 'thick') assert.deepEqual(drawn.copy, full, 'the backdrop alone is full')
  }
})

test('the jittered matrix is the one projected; singular and NaN projections fall back to full', () => {
  const { state, camera } = scene()
  const left = frame(state, camera).rect[0]
  const jitter = camera.viewProjection.slice()
  jitter[12] += 0.1
  assert.ok(frame(state, camera, jitter).rect[0] > left)
  assert.deepEqual(frame(state, camera, new Float64Array(16)).copy, full)
  jitter[0] = NaN
  assert.deepEqual(frame(state, camera, jitter).rect, full)
})

test('a clipped water box keeps legal edge texels, and two kept copies make one union', () => {
  const { state, item, camera } = scene()
  ;(item.matrix.elements as number[])[12] = -100
  const edge = frame(state, camera)
  if (edge.drawn) assert.ok(edge.rect[2] >= 1 && edge.copy[2] > 0)
  const other = scene()
  /** A copy `dx` along x, its own water rank `rank`. */
  const moved = (dx: number, rank: number) => {
    const box = other.item.bounds!.slice()
    box[0] += dx
    box[3] += dx
    const elements = Array.from(other.item.matrix.elements)
    elements[12] += dx
    const flags = (other.item.flags & ((1 << WATER_RANK_SHIFT) - 1)) | (rank << WATER_RANK_SHIFT)
    return { ...other.item, flags, bounds: box, matrix: { ...other.item.matrix, elements } }
  }
  const width = other.item.bounds![3] - other.item.bounds![0]
  other.state.blendGpu.splice(0, 1, other.item, moved(-1.2 * width, 2), moved(100 * width, 3))
  other.state.transmissive = 3
  other.state.volumePacked = new Float32Array(8 * 3)
  buildBlendStatics(other.state, uniformStride())
  refreshBlendPlan(other.state)
  const union = frame(other.state, other.camera)
  assert.equal(union.drawn, true, 'the far copy is rejected, the two near ones draw')
})
