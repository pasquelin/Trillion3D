import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeformationFrame } from './frame.ts'
import { deformationRuntime, unitRoot } from './deformationRuntime.fixture.ts'
import { deformedOf } from './source.ts'
import { updateWebgpuDeformation } from './webgpuFrame.ts'
import { growClusterBox } from '../lighting/shadows/casters/spheres.ts'
import { packClusterSpheres } from '../lighting/shadows/casters/spheres.fixture.ts'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import type { PageRec } from '../geometry/selection/types.ts'
import { followOffsets } from '../frame/render/offsetReach.ts'
import { graphRastersOf } from '../materials/graph/graphRasters.ts'
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts'
import { material } from '../../../sdk-core/src/world/material/index.ts'

test('deformation grows CPU/GPU light and occlusion bounds, and stales the shadows of what moved only', () => {
  const world = new Matrix4(),
    weights = [0]
  const frame = createDeformationFrame([
    deformedOf(
      { morphTargetInfluences: weights },
      { deformation: { joints: [], targets: [100] } },
      world,
    ),
  ])
  const rec = { min: [-1, -1, -1], max: [1, 1, 1] } as unknown as PageRec
  const root = unitRoot(world, rec)
  const { rt, changed } = deformationRuntime(world, frame, [root])
  const camera = { projection: world.elements } as EngineCamera
  updateWebgpuDeformation(rt, camera)
  assert.equal(frame.moving[0], 0, 'first upload does not invent TAA velocity')
  assert.equal(changed.length, 1, 'first deformation initializes its shadow region')
  weights[0] = 1
  updateWebgpuDeformation(rt, camera)
  const sphere = packClusterSpheres([rec], [root], new Float32Array(8), 0, 0, () => 0)
  assert.ok(sphere[3] >= 101, 'the GPU cull and shadow occlusion sphere contains maximum reach')
  const box = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity])
  growClusterBox(rec, [root], box, 0)
  assert.ok(box[0] <= -101 && box[3] >= 101, 'CPU light selection contains the same displacement')
  assert.deepEqual(changed.at(-1), [-101, -101, -101, 101, 101, 101])
  weights[0] = 0
  updateWebgpuDeformation(rt, camera)
  assert.deepEqual(changed.at(-1), [-101, -101, -101, 101, 101, 101], 'old shadows are erased')
})

/** A root of one page whose surface wears a graph that moves its vertices by `offset`, drawn from the
 *  node `node`, in a session that holds the graph’s offset. */
function offsetRoot(
  offset: (g: ReturnType<typeof material.graph>) => unknown,
  over = {},
  node = new Mesh(),
) {
  const g = material.graph('surface')
  g.output('baseColor', g.constant(1, 0, 0))
  g.output('worldPositionOffset', offset(g) as never)
  let versionReads = 0
  const surface = { graph: g, maxWorldPositionOffset: 2, ...over }
  Object.defineProperty(surface, 'version', {
    get: () => (versionReads++, 1),
  })
  const rec = {
    min: [-1, -1, -1],
    max: [1, 1, 1],
    material: surface,
    drawSource: { node },
  } as unknown as PageRec
  const world = new Matrix4()
  const root = unitRoot(world, rec)
  const frame = createDeformationFrame([])
  const eye = [0, 0, 0]
  const { rt, changed, marked } = deformationRuntime(world, frame, [root], {
    vis: { rasters: graphRastersOf([surface]) },
    run: { gate: { cam: { eye }, revisions: {} } },
  })
  return { rt, root, surface, marked, changed, node, eye, reads: () => versionReads }
}

const sway = (g: ReturnType<typeof material.graph>) => g.multiply(g.time(), g.constant(1, 0, 0))

test('a surface’s offset grows its root’s bounds by the greatest it may move a vertex; the shadow raster, not the scheduler, invalidates what it moves', () => {
  const moving = offsetRoot(sway)
  followOffsets(moving.rt)
  assert.equal(moving.root.reach, 2, 'its units: the root’s scale is one')
  assert.equal(moving.root.offsetReach, 2)
  assert.deepEqual(moving.marked, [0], 'its record is written again')
  assert.equal(
    moving.changed.length,
    0,
    'no shadow stale from the scheduler: the raster’s cull does it',
  )
  followOffsets(moving.rt)
  assert.deepEqual(moving.marked, [0], 'no record written again for a reach that held')
  // A root scaled by two reaches half as far in its own units.
  const scaled = offsetRoot(sway)
  scaled.root.world.elements[0] = scaled.root.world.elements[5] = scaled.root.world.elements[10] = 2
  followOffsets(scaled.rt)
  assert.equal(scaled.root.reach, 1)
})

test('the roots’ offsets are read once for a change, never each image: the surfaces are not walked again', () => {
  const root = offsetRoot(sway)
  followOffsets(root.rt)
  assert.deepEqual(
    root.rt.vis.rootOffsets.ranks(),
    [0],
    'the root that wears an offset is the one an image walks',
  )
  const walked = root.reads()
  assert.equal(walked, 0, 'a surface’s version is no part of the walk (the epoch says it moved)')
  for (let image = 0; image < 3; image++) followOffsets(root.rt)
  assert.equal(root.reads(), walked)
  // A surface whose offset facts moved (the table’s epoch) is read again.
  root.surface.maxWorldPositionOffset = 5
  Object.assign(root.rt.vis.materialTable, { offsetEpoch: 1 })
  followOffsets(root.rt)
  assert.equal(root.root.reach, 5)
  assert.equal(root.rt.vis.rootOffsets.rowOf(0)!.most, 5)
})

test('the object’s switches decide: off it reaches nothing; only `always` is declared to the scheduler', () => {
  const off = offsetRoot(sway)
  off.node.evaluateWorldPositionOffset = false
  followOffsets(off.rt)
  assert.equal(off.root.reach, 0, 'an offset the object does not evaluate grows no bound')
  assert.equal(off.changed.length, 0, 'no shadow stale for an offset not evaluated')
  assert.equal(off.rt.vis.rootOffsets.rowOf(0)!.evaluate, false, 'its record says so')
  // The distance and the surface that always evaluates are the raster's (the placement's distance
  // word, the surface's own bit): nothing is declared.
  const far = offsetRoot(sway)
  far.node.worldPositionOffsetDisableDistance = 10
  far.eye[0] = 5
  followOffsets(far.rt)
  assert.equal(far.changed.length, 0)
  // The cache switch: rigid and static leave the offset out of the invalidation, always declares a
  // root whatever it wears.
  for (const behaviour of ['rigid', 'static'] as const) {
    const quiet = offsetRoot(sway)
    quiet.node.shadowCacheInvalidation = behaviour
    followOffsets(quiet.rt)
    assert.equal(quiet.changed.length, 0, behaviour)
    assert.equal(quiet.root.reach, 2, 'the cut still reaches')
  }
  const plain = offsetRoot(sway)
  plain.surface.graph = undefined as never
  plain.node.shadowCacheInvalidation = 'always'
  plain.rt.vis.rasters = graphRastersOf([])
  followOffsets(plain.rt)
  assert.equal(plain.changed.length, 1, 'declared every image, though it wears no offset')
  followOffsets(plain.rt)
  assert.equal(plain.changed.length, 2)
})

test('the root’s offset words carry the centre of its bounds and the greatest offset of its surfaces', () => {
  const root = offsetRoot(sway)
  root.root.localBox = new Float64Array([0, 2, 4, 2, 4, 8])
  root.node.worldPositionOffsetDisableDistance = 7
  followOffsets(root.rt)
  const row = root.rt.vis.rootOffsets.rowOf(0)!
  assert.deepEqual(row.centre, [1, 3, 6])
  assert.equal(row.disable, 7)
  assert.equal(row.most, 2)
})
