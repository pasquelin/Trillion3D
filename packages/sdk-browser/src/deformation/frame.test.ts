import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeformationFrame } from './frame.ts'
import { deformedOf } from './source.ts'
import { KIND_MORPH, KIND_SKIN, KIND_WAVE, recordLayout } from './layout.ts'
import { animation } from '../../../sdk-core/src/world/animation/family.ts'
import { object } from '../../../sdk-core/src/world/object/index.ts'
import { WaterSurface } from '../../../sdk-core/src/fluids/waterSurface.ts'

const IDENTITY = { elements: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }

/** A skinned, morphed placement on two bones, and a plane the waves carry, scaled by two. */
function scene() {
  const root = object.group(),
    hip = object.group(),
    knee = object.group()
  ;[hip.name, knee.name] = ['hip', 'knee']
  knee.position.set(0, 1, 0)
  root.add(hip.add(knee))
  root.updateMatrixWorld(true)
  const body = { skeleton: animation.skeleton([hip, knee]), morphTargetInfluences: [0.5] }
  const measured = { deformation: { joints: [0, 0.5, 0, 0.5, 0, 1.5, 0, 0.5], targets: [2] } }
  const water = new WaterSurface({
    level: 0,
    waves: [{ direction: [1, 0], wavelength: 10, amplitude: 0.5, steepness: 0.5 }],
  })
  const sea = { waves: water }
  const doubled = { elements: new Float64Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]) }
  const placed = [deformedOf(body, measured, IDENTITY), null, deformedOf(sea, undefined, doubled)]
  return { root, knee, water, placed }
}

test('each deformed placement gets its record, moves when a source moves, and says how far', () => {
  const { root, knee, water, placed } = scene()
  const frame = createDeformationFrame(placed)
  assert.equal(frame.bases[1], 0, 'a placement that does not deform has no record')
  assert.equal(
    frame.update(() => false),
    true,
    'the first pose must be uploaded even without motion',
  )
  const words = new Uint32Array(frame.block.buffer)
  assert.equal(words[frame.bases[0] - 1], KIND_SKIN | KIND_MORPH)
  assert.equal(words[frame.bases[2] - 1], KIND_WAVE)
  // At rest the skin moves nothing; the half-weighted target moves one unit, the waves at most
  // amplitude plus lateral amplitude, halved by the placement's scale.
  assert.equal(frame.reach[0], 1)
  const wave = water.waveModel
  assert.ok(Math.abs(frame.reach[2] - (wave.amplitude[0] + wave.lateral[0]) / 2) < 1e-12)
  knee.quaternion.setFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2)
  root.updateMatrixWorld(true)
  assert.equal(
    frame.update(() => false),
    true,
  )
  assert.deepEqual([...frame.moving], [1, 0, 0], 'the still sea does not move')
  const at = frame.bases[0] - 1 + recordLayout(placed[0]!.shape).palette
  // The knee's palette now turns a quarter about z; the last frame's kept it at rest.
  assert.ok(
    Math.abs(frame.block[at + 12] - 0) < 1e-6 && Math.abs(frame.block[at + 12 + 24] - 1) < 1e-6,
  )
  assert.ok(frame.reach[0] > 1)
  water.setTime(1)
  frame.update((i) => i === 0)
  assert.equal(
    words[frame.bases[0] - 1],
    0,
    'drawn at rest when its reach projects below the error',
  )
  assert.equal(frame.reach[0], 0)
  assert.deepEqual([...frame.moving], [1, 0, 1])
})

test('an unchanged pose uploads its previous state once after movement stops', () => {
  const weights = [0]
  const placed = deformedOf(
    { morphTargetInfluences: weights },
    { deformation: { joints: [], targets: [2] } },
    IDENTITY,
  )!
  const frame = createDeformationFrame([placed])
  assert.equal(frame.revision, 0)
  assert.equal(
    frame.update(() => false),
    true,
  )
  assert.equal(frame.moving[0], 0, 'initial pose has no artificial motion')
  assert.equal(
    frame.update(() => false),
    false,
  )
  const stillRevision = frame.revision
  frame.update(() => false)
  assert.equal(frame.revision, stillRevision, 'unchanged source keeps its revision')
  weights[0] = 1
  assert.equal(
    frame.update(() => false),
    true,
  )
  const at = recordLayout(placed.shape).weights
  assert.deepEqual([...frame.block.slice(at, at + 2)], [1, 0])
  assert.equal(
    frame.update(() => false),
    true,
    'previous positions settle on the GPU',
  )
  assert.deepEqual([...frame.block.slice(at, at + 2)], [1, 1])
  assert.equal(frame.moving[0], 0)
  assert.equal(
    frame.update(() => false),
    false,
    'a settled pose sends nothing',
  )
})

test('a reused owner uploads and dirties shadows with equal previous/current poses and no TAA motion', () => {
  let owner = {},
    weights = [2]
  const mesh = {
    get sourceIdentity() {
      return owner
    },
    get morphTargetInfluences() {
      return weights
    },
  }
  const placed = deformedOf(mesh, { deformation: { joints: [], targets: [3] } }, IDENTITY)!
  const frame = createDeformationFrame([placed])
  assert.equal(
    frame.update(() => false),
    true,
  )
  assert.equal(frame.moving[0], 0)
  assert.equal(frame.dirty[0], 1, 'initial shadows need the first deformed pose')
  assert.equal(
    frame.update(() => false),
    false,
  )
  assert.equal(frame.dirty[0], 0)
  owner = {}
  weights = [4]
  assert.equal(frame.pending(), true, 'a reused row cannot hold the old image')
  assert.equal(
    frame.update(() => false),
    true,
  )
  const at = recordLayout(placed.shape).weights
  assert.deepEqual([...frame.block.slice(at, at + 2)], [4, 4])
  assert.equal(frame.moving[0], 0, 'the replacement has no previous pose to reproject')
  assert.equal(frame.dirty[0], 1, 'shadows must forget the previous owner')
  assert.equal(frame.reach[0], 12)
  assert.equal(
    frame.update(() => false),
    false,
  )
  assert.equal(frame.pending(), false)
})
