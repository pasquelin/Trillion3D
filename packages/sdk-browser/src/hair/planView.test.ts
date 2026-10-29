// What an image of the strands plans on the CPU: the visible instances in macro groups, the boxes of
// the instances in the camera's translated world, the entries and the camera's block.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wordViews } from '../gpu/core/wordViews.ts'
import { boxSphereOf } from './boxSphere.ts'
import { HAIR_BOUNDS_FLOATS, HAIR_ENTRY_WORDS, HAIR_MIN_VOXEL_SIZE } from './boundsPass.ts'
import type { HairBoundsUpdate } from './boundsPass.ts'
import type { HairFrameInputs } from './inputs.ts'
import { createHairShadowPlan } from './shadowCasters.ts'
import { planHairView, type HairInstance, type HairViewLists } from './scene.ts'
import type { HairShadowInputs } from './shadowCasters.ts'

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
/** The six planes of a view that sees everything: each at a distance of 1e9 in front of any point. */
const SEES_ALL = Float64Array.from([
  1, 0, 0, 1e9, -1, 0, 0, 1e9, 0, 1, 0, 1e9, 0, -1, 0, 1e9, 0, 0, 1, 1e9, 0, 0, -1, 1e9,
])

/** An instance whose points fill the unit box about `x`; it voxelizes if `voxelizes`. */
function instance(registeredIndex: number, x: number, voxelizes: boolean): HairInstance {
  const box = [x - 0.5, -0.5, -0.5, x + 0.5, 0.5, 0.5]
  return {
    registeredIndex,
    bounds: boxSphereOf(box),
    length: 0,
    supportsVoxelization: voxelizes,
    box: Float64Array.from(box),
  } as unknown as HairInstance
}

/** What the CPU writes for `count` instances, with a camera block that goes to no buffer. */
function updateOf(count: number) {
  const words = (n: number) => wordViews(new ArrayBuffer(n * 4))
  return {
    bounds: words(count * HAIR_BOUNDS_FLOATS),
    registered: words(count),
    entries: words(16 * HAIR_ENTRY_WORDS),
    camera: { words: words(24), send() {} },
    entryCount: 0,
    registeredCount: 0,
  } as unknown as HairBoundsUpdate
}

const lists = (): HairViewLists => ({ visible: [], shadowOnly: [], plan: createHairShadowPlan() })

const PERSPECTIVE = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0])
/** A view from (10, 0, 0) of an image of 64 by 64; `planes`, `projection` and `shadow` as given. */
const inputs = (
  planes = SEES_ALL,
  projection = PERSPECTIVE,
  shadow: HairShadowInputs | undefined = undefined,
  sizeInPixel = 1,
  pageResolution = 32,
): HairFrameInputs =>
  ({
    camera: {
      view: Float64Array.from(IDENTITY),
      projection,
      near: 0.1,
      eye: Float64Array.from([10, 0, 0]),
      viewRelative: Float64Array.from(IDENTITY),
      planes,
      perspective: projection[11] === -1 ? 1 : 0,
    },
    size: [64, 64],
    sizeInPixel,
    pageResolution,
    shadow,
  }) as unknown as HairFrameInputs

test('the instances that voxelize are listed, their boxes written relative to the eye', () => {
  const all = [instance(0, 10, true), instance(1, 10.5, false), instance(2, 500, true)]
  const update = updateOf(3)
  const groups = planHairView(all, update, lists(), inputs())
  assert.deepEqual(
    groups.map((group) => group.members.map((one) => one.registeredIndex)),
    [[0, 1], [2]],
  )
  assert.equal(update.entryCount, 2)
  assert.equal(update.registeredCount, 2)
  // Instance 0: x from 9.5 to 10.5, the eye at 10.
  assert.deepEqual(Array.from(update.bounds.f.slice(0, 8)), [-0.5, -0.5, -0.5, 0, 0.5, 0.5, 0.5, 0])
  // The first group lists instance 0 alone (instance 1 does not voxelize); the second, instance 2.
  assert.deepEqual(Array.from(update.registered.u.slice(0, 2)), [0, 2])
  assert.deepEqual(
    Array.from(update.entries.u.slice(0, 2 * HAIR_ENTRY_WORDS)),
    [0, 0, 1, 0, 1, 1, 1, 0],
  )
})

test('an instance outside the frustum joins no group unless a light that casts reaches it', () => {
  const outside = Float64Array.from([...SEES_ALL.slice(0, 20), 0, 0, 1, -1e9])
  const all = [instance(0, 10, true)]
  assert.equal(planHairView(all, updateOf(1), lists(), inputs(outside)).length, 0)
  const near: HairShadowInputs = {
    lights: [{ kind: 'point', position: [10, 0, 0], range: 5 }],
    distance: 20,
  }
  const update = updateOf(1)
  const [group, ...others] = planHairView(all, update, lists(), inputs(outside, PERSPECTIVE, near))
  assert.equal(others.length, 0)
  assert.equal(group!.members.length, 0, 'it is not drawn')
  assert.deepEqual(
    group!.shadowMembers.map((one) => one.registeredIndex),
    [0],
  )
  assert.equal(update.registeredCount, 1, 'it is voxelized for the shadows')
  const far: HairShadowInputs = {
    lights: [{ kind: 'point', position: [100, 0, 0], range: 5 }],
    distance: 20,
  }
  const unreached = planHairView(all, updateOf(1), lists(), inputs(outside, PERSPECTIVE, far))
  assert.equal(unreached.length, 0, 'a light out of reach leaves it out')
})

test('the camera block holds the orientation, the size of a pixel, the voxel span and the page', () => {
  const update = updateOf(1)
  const view = inputs(SEES_ALL, PERSPECTIVE, undefined, 100, 33)
  planHairView([instance(0, 10, true)], update, lists(), view)
  const { f, u } = update.camera.words
  assert.deepEqual(Array.from(f.slice(0, 16)), IDENTITY)
  // A perspective projection of 90 degrees on an image 64 high: tan(45°) / 32.
  assert.equal(f[16], Math.fround(1 / 32))
  // The settings are taken as they are (their rules hold them to a range); a page of 33 voxels is
  // rounded up to 64.
  assert.equal(f[17], 100)
  assert.equal(u[18], 64)
  assert.equal(f[19], Math.fround(HAIR_MIN_VOXEL_SIZE))
  assert.equal(u[20], 1, 'a perspective projection')
})

test('an orthographic view takes its pixel size from its width over the pixels across it', () => {
  const update = updateOf(1)
  const ortho = Float64Array.from([0.01, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  planHairView([instance(0, 10, true)], update, lists(), inputs(SEES_ALL, ortho))
  // A width of 2 / 0.01 = 200 units over 64 pixels; never held to 1, as a width in metres is not.
  assert.equal(update.camera.words.f[16], 3.125)
  assert.equal(update.camera.words.u[20], 0, 'an orthographic projection')
  const wide = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  planHairView([instance(0, 10, true)], update, lists(), inputs(SEES_ALL, wide))
  assert.equal(update.camera.words.f[16], 0.03125)
})
