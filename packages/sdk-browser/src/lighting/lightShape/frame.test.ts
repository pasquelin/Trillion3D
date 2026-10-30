// The light shapes' visualization (`frame.ts`, `lightShapeWgsl.ts`): the switch's fade state, the instances of the lights drawn from the farthest to the nearest,
// the vertex stages' deformation of each kind of light, the fragment's opacity.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LIGHT_KIND,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
} from '../../../../sdk-core/src/scene/light/contracts.ts'
import { LIGHT_FIELD } from '../../../../sdk-core/src/scene/light/fields.ts'
import { lightShapeValues } from '../../../../sdk-core/src/contracts/lightShapeOptions.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { lightShapeInstances, toggledShapes } from './frame.ts'
import { rectMesh } from './meshes.ts'
import {
  LIGHT_SHAPE_ENTRIES,
  LIGHT_SHAPE_FRAGMENT,
  LIGHT_SHAPE_INSTANCE_FLOATS,
  lightShapeShader,
} from './lightShapeWgsl.ts'

test('the switch fades in from the time it is turned on and out over the fade duration from the time it is turned off', () => {
  const held = { toggle: 0 }
  assert.equal(toggledShapes(held, false, 5, 0.5), false, 'off from the start')
  assert.equal(toggledShapes(held, true, 10, 0.5), true)
  assert.equal(held.toggle, 10)
  assert.equal(toggledShapes(held, true, 20, 0.5), true, 'kept while on')
  assert.equal(toggledShapes(held, false, 30, 0.5), true, 'the fade out begins')
  assert.equal(held.toggle, -30)
  assert.equal(toggledShapes(held, false, 30.4, 0.5), true)
  assert.equal(toggledShapes(held, false, 30.6, 0.5), false, 'the fade out is done')
  // A clock gone back starts over.
  assert.equal(toggledShapes(held, true, 1, 0.5), true)
  assert.equal(held.toggle, 1)
})

test('the settings are held to their ranges where they are read', () => {
  const read = (values: Record<string, number>) => (field: string) => values[field]
  const v = lightShapeValues(
    read({
      visualizeLightShapeFadeDuration: -1,
      visualizeLightShapeMaxDelayDistance: 5,
      visualizeLightShapeMaxDelay: -2,
      visualizeLightShapeMaxOpacity: 3,
    }) as never,
  )
  assert.deepEqual(v, { fadeDuration: 0, maxDelayDistance: 100, maxDelay: 0, maxOpacity: 1 })
})

/** A packed store of lights, each `[kind, x, y, z, range]`. */
function packedLights(lights: number[][]) {
  const packed = new Float32Array(SCENE_LIGHT_HEADER_FLOATS + lights.length * SCENE_LIGHT_FLOATS)
  lights.forEach(([, x, y, z, range], slot) => {
    const base = SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS
    packed.set([x, y, z], base + LIGHT_FIELD.position)
    packed[base + LIGHT_FIELD.range] = range
    packed.set([0, 0, -1], base + LIGHT_FIELD.direction)
    packed[base + LIGHT_FIELD.cosCone] = 0.5
  })
  return packed
}

test('the lights are drawn from the farthest to the nearest, the directional ones and those out of range left out', () => {
  const lights = [
    [LIGHT_KIND.point, 1, 0, 0, 5],
    [LIGHT_KIND.spot, 9, 0, 0, 5],
    [LIGHT_KIND.directional, 50, 0, 0, 5],
    [LIGHT_KIND.rect, 4, 0, 0, 5],
    [LIGHT_KIND.point, 20, 0, 0, 0],
    [LIGHT_KIND.point, 9, 0, 0, 5],
  ]
  const held = { data: new Float32Array(0) }
  const { count, kinds } = lightShapeInstances(
    packedLights(lights),
    (slot) => lights[slot][0],
    lights.length,
    [0, 0, 0],
    (slot) => slot !== 99,
    held,
  )
  assert.equal(count, 4)
  // The two at 9 metres tie: the later kind (the spot, slot 1) before the point (slot 5)? Kind rank 1 > 0.
  assert.deepEqual(kinds, ['spot', 'point', 'rect', 'point'])
  const slotOf = (at: number) => held.data[at * LIGHT_SHAPE_INSTANCE_FLOATS + 15]
  assert.deepEqual([0, 1, 2, 3].map(slotOf), [1, 5, 3, 0])
  assert.equal(held.data[3], 5, 'the range follows the place')
})

test('the vertex stages place a point light’s sphere, a spot’s cone and a rectangle’s box about the light, and the fragment is faint', () => {
  const program = lightShapeShader()
  for (const entry of Object.values(LIGHT_SHAPE_ENTRIES))
    assertProgramAssembles(program, entry, `the light shape ${entry}`)
  assertProgramAssembles(program, LIGHT_SHAPE_FRAGMENT, 'the light shape fragment')
  const identity = Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0))
  const run = shaderRun<Record<string, (shape: object) => { position: number[] }>>(
    program,
    Object.values(LIGHT_SHAPE_ENTRIES),
    { fade: { viewProjection: new Mat(identity) } },
  )
  const place = [10, 20, 30, 4]
  // A point light: the unit sphere times the range about the place.
  const point = run.pointShape({
    local: [0, 0, 1],
    place,
    axis: [0, 0, 1, 0],
    up: [0, 1, 0, 0],
    size: [0, 0, 0, 7],
  })
  assert.deepEqual(point.position.slice(0, 3), [10, 20, 34])
  // A spot light looking down +z with a cone of 60 degrees: the rim ring (the first coordinate 1) lies at the range, 60 degrees off the axis.
  const rim = run.spotShape({
    local: [1, 1, 0],
    place,
    axis: [0, 0, 1, 0.5],
    up: [0, 1, 0, 0],
    size: [0, 0, 0, 7],
  })
  const [x, y, z] = [rim.position[0] - 10, rim.position[1] - 20, rim.position[2] - 30]
  assert.ok(Math.abs(Math.hypot(x, y, z) - 4) < 1e-5, 'on the sphere of the range')
  assert.ok(Math.abs(z - 4 * 0.5) < 1e-5, 'at the cone’s angle from the axis')
  // The ring past the rim folds back to the apex.
  const apex = run.spotShape({
    local: [1.1, 1, 0],
    place,
    axis: [0, 0, 1, 0.5],
    up: [0, 1, 0, 0],
    size: [0, 0, 0, 7],
  })
  assert.deepEqual(apex.position.slice(0, 3), [10, 20, 30])
})

test('a rectangle light’s box is the rectangle between its barn doors and the sphere of its range, forward of the light', () => {
  const identity = Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0))
  const run = shaderRun<Record<string, (shape: object) => { position: number[] }>>(
    lightShapeShader(),
    [LIGHT_SHAPE_ENTRIES.rect],
    { fade: { viewProjection: new Mat(identity) } },
  )
  const rect = rectMesh()
  const place = [0, 0, 0, 10]
  let farthest = 0
  for (let i = 0; i < rect.vertices.length; i += 3) {
    const at = run.rectShape({
      local: [...rect.vertices.subarray(i, i + 3)],
      place,
      axis: [0, 0, 1, 0],
      up: [0, 1, 0, Math.cos((88 * Math.PI) / 180)],
      size: [1, 0.5, 0.2, 0],
    }).position
    const along = at[2]
    assert.ok(along >= -0.2 - 1e-6, 'nothing behind the barn doors')
    assert.ok(Math.hypot(at[0], at[1], at[2]) <= 10 + 1e-4, 'inside the sphere of the range')
    farthest = Math.max(farthest, Math.hypot(at[0], at[1], at[2]))
  }
  assert.ok(Math.abs(farthest - 10) < 1e-3, 'the far end reaches the sphere')
})
