// The deformation stage's lengths moved from `hypot3` to the engine's one rule, `length3`
// (docs/MATHS.md "Lengths"): the two may part in the last bit of a double. Each sweep holds the old
// expression as its oracle and proves that what the stage decides or sends the GPU does not move:
// the skip of a root too small to show its deformation (`screen.ts`), and a soft body's reach,
// read as a float32 and as the half float of its mark word (`softSource.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeformationSkip } from './screen.ts'
import { receiveSoftSource, type SoftSource } from './softSource.ts'
import { markReach } from './halfFloat.ts'
import { createEngineCamera } from '../camera/world.ts'
import { viewDepthOf, viewLateralOf } from '../page/selection/projection.ts'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { screenErrorBound } from '../../../sdk-core/src/lod/screenErrorBound.ts'
import { hypot3 } from '../../../math/src/float/hypot.ts'
import { length3 } from '../../../math/src/vector/vector.ts'
import {
  orthographicProjection,
  perspectiveProjection,
} from '../../../math/src/projection/camera.ts'
import {
  assertSameFloat32,
  edgeValues,
  HALTON_SWEEP,
  haltonSpan,
} from '../../../math/src/sequence/sweep.fixture.ts'
import type { ClusterRoot, PageRec } from '../page/selection/selection.ts'

const VIEWPORT: [number, number] = [1920, 1080]

test('the deformation skip decides as the hypot3 radius did, on every swept root', () => {
  const skipAt = createDeformationSkip()
  const camera = createEngineCamera()
  camera.near = 0.1
  const view = new Matrix4()
  const root = { pages: [], world: new Matrix4(), worldBox: new Float64Array(6) }
  const roots = [root as unknown as ClusterRoot<PageRec>]
  let skips = 0,
    parted = 0
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    // Perspective and orthographic cameras in turn, each placed off the origin.
    const perspective = i & 1
    camera.perspective = perspective
    if (perspective) perspectiveProjection(camera.projection, 55, 16 / 9, camera.near, 1)
    else orthographicProjection(camera.projection, -40, 40, -22.5, 22.5, camera.near, 4000)
    view.makeTranslation(haltonSpan(i, 13, -30, 30), haltonSpan(i, 17, -30, 30), 0)
    camera.view.set(view.elements)
    const x = haltonSpan(i, 2, -300, 300),
      y = haltonSpan(i, 3, -300, 300),
      z = haltonSpan(i, 5, -3000, -0.5)
    const hx = haltonSpan(i, 7, 0.001, 60),
      hy = haltonSpan(i, 11, 0.001, 60),
      hz = haltonSpan(i, 19, 0.001, 60)
    root.worldBox.set([x - hx, y - hy, z - hz, x + hx, y + hy, z + hz])
    const reach = haltonSpan(i, 23, 0, 3),
      threshold = haltonSpan(i, 29, 0.25, 4)
    const skipped = skipAt(roots, camera, VIEWPORT, threshold)
    // The old `pixelsOf`, its radius `hypot3`, at the old `pixelScaleOf` focal.
    const box = root.worldBox,
      p = camera.projection
    const cx = (box[0] + box[3]) / 2,
      cy = (box[1] + box[4]) / 2,
      cz = (box[2] + box[5]) / 2
    const focal = Math.max((VIEWPORT[0] * Math.abs(p[0])) / 2, (VIEWPORT[1] * Math.abs(p[5])) / 2)
    const radius = hypot3(box[3] - cx, box[4] - cy, box[5] - cz)
    if (radius !== length3(box[3] - cx, box[4] - cy, box[5] - cz)) parted++
    const old = screenErrorBound(
      reach,
      1,
      viewLateralOf(cx, cy, cz, camera.view),
      viewDepthOf(cx, cy, cz, camera.view),
      radius,
      focal,
      camera.near,
      perspective,
    )
    assert.equal(skipped(0, reach), old < threshold, `root ${i}`)
    if (old < threshold) skips++
  }
  // The sweep meets both decisions, and radii where the two rules part.
  assert.ok(skips > 0 && skips < HALTON_SWEEP, `${skips} skips`)
  assert.ok(parted > 0, 'no radius parts')
})

/** A soft source of one vertex, resting at `rest`. */
function oneVertex(rest: ArrayLike<number>): SoftSource {
  const at = Float32Array.from(rest)
  return {
    rest: at,
    positions: at.slice(),
    normals: new Float32Array(3),
    indices: new Uint32Array(0),
    version: 1,
    reach: 0,
  }
}

test('a soft body reach is the hypot3 one as a float32 and as its mark half float', () => {
  const moved = new Float32Array(3)
  let parted = 0
  const check = (rest: number[], label: string) => {
    const source = oneVertex(rest)
    assert.ok(receiveSoftSource(source, moved))
    const r = source.rest
    const old = Math.max(0, hypot3(moved[0] - r[0], moved[1] - r[1], moved[2] - r[2]))
    if (old !== source.reach) parted++
    assertSameFloat32(old, source.reach, label)
    assert.equal(markReach(0, source.reach), markReach(0, old), `${label} mark`)
  }
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const rest = [haltonSpan(i, 2, -50, 50), haltonSpan(i, 3, -50, 50), haltonSpan(i, 5, -50, 50)]
    moved[0] = rest[0] + haltonSpan(i, 7, -2, 2)
    moved[1] = rest[1] + haltonSpan(i, 11, -2, 2)
    moved[2] = rest[2] + haltonSpan(i, 13, -2, 2)
    check(rest, `vertex ${i}`)
  }
  // Edge displacements on one axis, the vertex resting at the origin.
  for (const edge of edgeValues(-1e6, 1e6)) {
    moved.set([edge, 0.5, -0.25])
    check([0, 0, 0], `edge ${edge}`)
  }
  assert.ok(parted > 0, 'no reach parts in double')
})
