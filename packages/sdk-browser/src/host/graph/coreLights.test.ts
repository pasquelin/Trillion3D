/**
 * The engine builds, numbers, aims and draws the core's lights (#944): each kind the contract or a
 * scene file declares becomes a `Light`, numbered in the engine's one count, and the WebGL2
 * cluster path uploads each kind in its slot, or refuses by name a kind it does not draw.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Light } from '../../../../sdk-core/src/world/light/light.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import { IRRADIANCE_BAND } from '../../../../sdk-core/src/scene/core/environment.ts'
import { IDENTITY_ELEMENTS } from '../../math/matrixElements.ts'
import { createLight } from '../../lighting/lightWrite.ts'
import { light as preparedLight } from '../prepared/nodes.ts'
import { unsupportedClusterLight, WebglClusterLights } from '../../webgl/cluster/lights.ts'
import { aimOf, isLightNode } from './kinds.ts'
import { isPlacedLight } from './graphLights.fixture.ts'
import { serialOf } from './serial.ts'

/** A WebGL2 context that answers every call and keeps the light records and probe uniforms. */
function recordingGl() {
  const seen = { records: new Float32Array(0), probe: new Float32Array(0) }
  const gl = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_, name) => (name in seen ? seen[name as keyof typeof seen] : record(name)),
  })
  function record(name: string | symbol) {
    return (...args: unknown[]) => {
      if (name === 'texSubImage2D' && args[8] instanceof Float32Array)
        seen.records = Float32Array.from(args[8])
      if (name === 'uniform3fv') seen.probe = Float32Array.from(args[1] as Float32Array)
      if (name === 'getUniformLocation') return args[1]
      return {}
    }
  }
  return { gl: gl as unknown as WebGL2RenderingContext, seen }
}

/** The kind each of the first `count` slots of the uploaded records carries (its second vec4's `w`). */
const slotKinds = (block: Float32Array, count: number) =>
  Array.from({ length: count }, (_, i) => block[i * 16 + 7])

test('each kind the contract declares becomes the core light, numbered, aiming only when it aims', () => {
  const made = (['point', 'spot', 'directional', 'rect'] as const).map((kind) =>
    createLight({ id: kind, kind, color: [1, 1, 1], intensity: 1, castsShadow: false }),
  )
  assert.deepEqual(
    made.map((light) => light.kind),
    ['point', 'spot', 'directional', 'rectArea'],
  )
  assert.ok(made.every((light) => light instanceof Light && isLightNode(light)))
  const numbers = made.map((light) => serialOf(light)!)
  assert.deepEqual(
    numbers,
    [...numbers].sort((a, b) => a - b),
    'numbered in creation order',
  )
  assert.deepEqual(
    made.map((light) => aimOf(light) === light.target),
    [false, true, true, false],
    'a sun and a spot aim at their target; a point and a rectangle at nothing',
  )
  assert.equal(serialOf(new Light('point')), undefined, 'a light a page builds takes no number')
})

test('a light a scene file declares is the core light, a sun or a spot aiming down its own -z', () => {
  const spot = preparedLight({ type: 'spot', intensity: 3, outerConeAngle: 0.5 } as never, 'lamp')
  const point = preparedLight({ type: 'point', intensity: 2 } as never, 'bulb')
  assert.ok(isPlacedLight(spot) && isPlacedLight(point))
  assert.deepEqual([spot.target.parent, spot.target.position.z], [spot, -1])
  assert.equal(point.target.parent, null, 'a point holds a target it never aims at')
  assert.equal(aimOf(point), undefined)
  assert.ok(serialOf(spot)! < serialOf(point)!)
})

test('the WebGL2 cluster path uploads each kind in its slot, in the reference order', () => {
  const scene = new Group()
  const sun = new Light('directional', { position: [0, 1, 0] })
  const rect = new Light('rectArea', { color: [1, 0.5, 0.25], intensity: 2, width: 4, height: 2 })
  const spot = new Light('spot', { intensity: 5, angle: 0.5, penumbra: 0.2, distance: 9 })
  const point = new Light('point', { intensity: 3, distance: 7 })
  const ambient = new Light('ambient', { color: [0.5, 0.5, 0.5], intensity: 2 })
  const probe = new Light('probe', { sh: Array.from({ length: 27 }, (_, i) => i), intensity: 0.5 })
  scene.add(sun, sun.target, rect, spot, spot.target, point, ambient, probe)
  scene.updateMatrixWorld(true)
  const lights = [sun, rect, spot, point, ambient, probe]
  assert.equal(unsupportedClusterLight(lights), undefined)
  const { gl, seen } = recordingGl()
  const count = new WebglClusterLights(gl, {} as WebGLProgram).upload({ lights }, IDENTITY_ELEMENTS)
  assert.equal(count, 5, 'four direct lights and one ambient slot; the probe takes none')
  assert.deepEqual(
    slotKinds(seen.records, count),
    [1, 2, 0, 4, 3],
    'points, spots, suns, rectangles',
  )
  assert.deepEqual(
    [seen.records[3], seen.records[16 + 3]],
    [7, 9],
    'the ranges of the point and spot',
  )
  assert.deepEqual([seen.records[60], seen.records[63]], [2, 1], 'the rectangle: its half sides')
  assert.deepEqual([...seen.records.slice(72, 76)], [1, 1, 1, 1], 'the ambient: colour × intensity')
  assert.deepEqual(
    [...seen.probe],
    Array.from({ length: 27 }, (_, i) => i * 0.5),
    'the probe: its coefficients × intensity',
  )
})

test('a probe with no coefficients adds its colour everywhere, as a world adds it', () => {
  const lights = [new Light('probe', { color: [0.5, 0.25, 1], intensity: 2 })]
  const { gl, seen } = recordingGl()
  new WebglClusterLights(gl, {} as WebGLProgram).upload({ lights }, IDENTITY_ELEMENTS)
  const constant = [1, 0.5, 2].map((c) => Math.fround(c / IRRADIANCE_BAND.constant))
  assert.deepEqual([...seen.probe.slice(0, 3)], constant)
  assert.ok(
    seen.probe.slice(3).every((c) => c === 0),
    'the other bands stay empty',
  )
})

test('a sky over a ground is refused by name on the WebGL2 cluster path', () => {
  assert.equal(
    unsupportedClusterLight([new Light('hemisphere')]),
    'hemisphere light is not drawn by the WebGL2 cluster path',
  )
})
