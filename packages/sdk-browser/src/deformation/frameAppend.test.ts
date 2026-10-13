import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeformationFrame } from './frame.ts'
import { deformedOf } from './source.ts'
import { recordLayout } from './layout.ts'
import { animation } from '../../../sdk-core/src/world/animation/family.ts'
import { object } from '../../../sdk-core/src/world/object/index.ts'
import { WaterSurface } from '../../../sdk-core/src/fluids/waterSurface.ts'

const IDENTITY = { elements: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }
const measured = { deformation: { joints: [0, 0.5, 0, 0.5, 0, 1.5, 0, 0.5], targets: [2] } }

/** Placements of every kind, `count` of each: a skin with a morph, waves, and one that deforms nothing. */
function placements(count: number) {
  const hip = object.group(),
    knee = object.group()
  knee.position.set(0, 1, 0)
  hip.add(knee)
  hip.updateMatrixWorld(true)
  const sea = new WaterSurface({
    level: 0,
    waves: [{ direction: [1, 0], wavelength: 10, amplitude: 0.5, steepness: 0.5 }],
  })
  const made = []
  for (let i = 0; i < count; i++) {
    const body = { skeleton: animation.skeleton([hip, knee]), morphTargetInfluences: [0.25 * i] }
    made.push(
      deformedOf(body, measured, IDENTITY),
      null,
      deformedOf({ waves: sea }, undefined, IDENTITY),
    )
  }
  return made
}

test('records appended to a frame are the records of a frame made over all of them', () => {
  const all = placements(5),
    whole = createDeformationFrame(all),
    grown = createDeformationFrame(all.slice(0, 3))
  grown.update(() => false)
  grown.append(all.slice(3, 9))
  grown.append(all.slice(9))
  whole.update(() => false)
  grown.update(() => false)
  whole.update(() => false)
  grown.update(() => false)
  assert.equal(grown.floats, whole.floats, 'the records span exactly the floats of the added ones')
  assert.ok(grown.block.length >= grown.floats && grown.block.length < 2 * grown.floats + 1)
  assert.deepEqual([...grown.bases.subarray(0, 15)], [...whole.bases.subarray(0, 15)])
  assert.equal(grown.deforming, whole.deforming)
  // The records written after the append are the whole frame's, bit for bit: the old ones keep
  // their history, the new ones are written cold as a fresh open writes them.
  assert.deepEqual(
    [...grown.block.subarray(0, grown.floats)],
    [...whole.block.subarray(0, whole.floats)],
  )
})

test('a frame grows its records by the layout of each placement added, and no more', () => {
  const frame = createDeformationFrame()
  assert.equal(frame.floats, 0)
  const added = placements(2)
  assert.equal(frame.append(added), 0)
  const floats = added.reduce(
    (sum, entry) => sum + (entry ? recordLayout(entry.shape).floats : 0),
    0,
  )
  assert.equal(frame.floats, floats)
  assert.equal(frame.append(placements(1)), 6, 'a placement joins at the rank behind the others')
  assert.equal(frame.deforming, 6)
})
