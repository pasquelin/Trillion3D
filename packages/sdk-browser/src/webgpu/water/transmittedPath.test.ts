// A volume's declared thickness is the mesh's (KHR_materials_volume: "in the coordinate space of
// the mesh"), one unit for the water and the shadow it casts: the shipped `transmittedBackdrop` runs
// as JavaScript (`shaderRun`) over an empty backdrop, where the ray travels the whole volume, and
// reads the path its item's pose gives the declared thickness (`volumeWorldPath`), the shadow's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { WATER_TRANSMITTED_WGSL } from './transmittedWgsl.ts'
import { volumeAttenuation } from '../transparent/volumeLaw.ts'

type Vec = number[]
type Run = {
  transmittedBackdrop: (
    vol: object,
    P: Vec,
    N: Vec,
    V: Vec,
    straight: Vec,
    fragZ: number,
  ) => {
    color: Vec
  }
  volumeWorldPath: (world: Vec[], thickness: number, ray: Vec) => number
}

/** A placement's world matrix, column-major columns, scaled by `x, y, z` along its axes. */
const world = (x: number, y: number, z: number) => [
  [x, 0, 0, 0],
  [0, y, 0, 0],
  [0, 0, z, 0],
  [0, 0, 0, 1],
]

/** WGSL's `refract` of incident `I` through normal `N` at ratio `eta`. */
function refract(I: Vec, N: Vec, eta: number) {
  const d = I.reduce((sum, v, i) => sum + v * N[i], 0),
    k = 1 - eta * eta * (1 - d * d)
  return k < 0 ? [0, 0, 0] : I.map((v, i) => eta * v - (eta * d + Math.sqrt(k)) * N[i])
}

/** The path `transmittedBackdrop` advances the exit by and the colour it reads, for a volume two
 *  and a half units thick whose item stands at `pose`, seen straight down its axis `z`. */
function seen(pose: Vec[]) {
  let advanced = NaN
  const backdropDepth = { name: 'depth' },
    backdrop = { name: 'colour' }
  const run = shaderRun<Run>(
    WATER_TRANSMITTED_WGSL,
    [
      'transmittedBackdrop',
      'backdropDistance',
      'volumeWorldPath',
      'volumeTransmittance',
      'cofactor3',
    ],
    {
      backdropDepth,
      backdrop,
      // Nothing drawn under the water: the ray crosses the whole volume.
      textureLoad: (texture: object) => (texture === backdropDepth ? 0 : [1, 1, 1, 1]),
      worldAt: () => [0, 0, -100],
      exitPixel: (P: Vec, dir: Vec, dist: number, straight: Vec) => ((advanced = dist), straight),
      refract,
      mat3x3f: (...columns: Vec[]) => columns,
      Transmitted: (color: Vec, coverage: number) => ({ color, coverage }),
      view: { viewport: [8, 8, 0, 0] },
      items: [{ world: pose }],
    },
  )
  const vol = {
    transmission: 1,
    eta: 1,
    thickness: 2.5,
    f0: 0,
    // Half the light kept per unit of world path.
    attenuation: [...volumeAttenuation([0.5, 0.5, 0.5], 1), 0],
    item: 0,
  }
  const { color } = run.transmittedBackdrop(vol, [0, 0, 0], [0, 0, 1], [0, 0, 1], [3, 4], 0.5)
  const shadow = run.volumeWorldPath(pose, vol.thickness, [0, 0, -1])
  return { advanced, color, shadow }
}

test('a placement scaled twice makes the water travel and absorb twice the declared thickness', () => {
  const rigid = seen(world(1, 1, 1))
  assert.equal(rigid.advanced, 2.5, 'an unscaled placement travels the declared thickness')
  assert.deepEqual(rigid.color, [2 ** -2.5, 2 ** -2.5, 2 ** -2.5])
  const scaled = seen(world(2, 2, 2))
  assert.equal(scaled.advanced, 5, 'the exit is read twice as far')
  assert.deepEqual(scaled.color, [2 ** -5, 2 ** -5, 2 ** -5], 'and absorbs over twice the path')
  // The shadow's path is the water's: one rule, one helper.
  assert.equal(scaled.shadow, scaled.advanced)
  // Only the scale along the ray counts.
  assert.equal(seen(world(5, 7, 3)).advanced, 7.5)
})
