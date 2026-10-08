// The length rule on the waves (docs/MATHS.md "Lengths"): each direction normalised, and the
// surface normal, swept over Halton waves and points against their former expression — `hypot2`
// or `hypot3`, then a division by the length —, every value narrowed to f32 identical.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Waves, type WaveSpec } from './waves.ts'
import { OCEAN } from './waves.fixture.ts'
import { halton } from '../../../math/src/sequence/halton.ts'
import { hypot2, hypot3 } from '../../../math/src/float/hypot.ts'
import { TAU } from '../../../math/src/constants.ts'

const same = (a: number, b: number) => Object.is(Math.fround(a), Math.fround(b))

/** Eight waves from the Halton terms from `from`: directions of any length from 1e-3 to 1e3 and
 *  any heading, wavelengths of 1 to 80 m, steepness summed past 1. */
const sea = (from: number): WaveSpec[] =>
  Array.from({ length: 8 }, (_, w) => {
    const i = from + w,
      scale = 10 ** (6 * halton(i, 7) - 3)
    return {
      direction: [scale * (2 * halton(i, 2) - 1), scale * (2 * halton(i, 3) - 1)],
      wavelength: 1 + 79 * halton(i, 5),
      amplitude: 0.02 + halton(i, 11),
      steepness: halton(i, 13),
      phase: TAU * halton(i, 17),
    }
  })

/** The former normal of `Waves.normal`, word for word, on the waves' own numbers. */
function oldNormal(waves: Waves, x: number, z: number) {
  let nx = 0,
    ny = 1,
    nz = 0
  for (let i = 0; i < waves.count; i++) {
    const f = waves.k[i] * (waves.dirX[i] * x + waves.dirZ[i] * z) - waves.phase[i]
    const ka = waves.k[i] * waves.amplitude[i],
      c = Math.cos(f)
    nx -= waves.dirX[i] * ka * c
    ny -= waves.k[i] * waves.lateral[i] * Math.sin(f)
    nz -= waves.dirZ[i] * ka * c
  }
  const length = hypot3(nx, ny, nz)
  return [nx / length, ny / length, nz / length]
}

test('wave directions, heights and normals of the former normalise, every f32 the same', () => {
  // 512 seas of eight waves: 4096 directions, each sea's surface read at eight points; the edges
  // are the ocean fixture and axis directions of either sign.
  const seas = Array.from({ length: 512 }, (_, s) => sea(1 + s * 8))
  seas.push(OCEAN, [
    { direction: [-0, -3], wavelength: 9, amplitude: 0.3, steepness: 1 },
    { direction: [5e-3, 0], wavelength: 4, amplitude: 0.2, steepness: 0.5 },
    { direction: [3, 4], wavelength: 2, amplitude: 0.1, steepness: 0.5 },
  ])
  // Host directions past the plain sum's range, either side: unit all the same.
  seas.push(
    [
      [1e200, 0],
      [3e154, -4e154],
      [-1e-170, 0],
      [3e-163, 4e-163],
    ].map((direction) => ({
      direction: direction as [number, number],
      wavelength: 3,
      amplitude: 0.1,
      steepness: 0.2,
    })),
  )
  const offset = new Float64Array(3),
    former = new Float64Array(3),
    normal = new Float64Array(3)
  seas.forEach((specs, s) => {
    const waves = new Waves(specs),
      old = new Waves(specs)
    specs.forEach(({ direction: [x, z] }, i) => {
      const length = hypot2(x, z)
      old.dirX[i] = x / length
      old.dirZ[i] = z / length
      assert.ok(same(old.dirX[i], waves.dirX[i]) && same(old.dirZ[i], waves.dirZ[i]), `sea ${s}`)
    })
    const t = 300 * halton(s + 1, 19)
    waves.setTime(t)
    old.setTime(t)
    for (let p = 0; p < 8; p++) {
      const x = 400 * halton(s * 8 + p + 1, 23) - 200,
        z = 400 * halton(s * 8 + p + 1, 29) - 200
      waves.offset(x, z, offset)
      old.offset(x, z, former)
      waves.normal(x, z, normal)
      const expected = oldNormal(old, x, z)
      for (let k = 0; k < 3; k++) {
        assert.ok(same(former[k], offset[k]), `sea ${s} offset ${x}, ${z}`)
        assert.ok(same(expected[k], normal[k]), `sea ${s} normal ${x}, ${z}`)
      }
    }
  })
})

test('a direction is refused by the former verdict: zero, NaN or none, at any magnitude', () => {
  for (const direction of [
    [0, 0],
    [-0, 0],
    [NaN, 1],
    [1e-3, 0],
    [Infinity, 1],
    [1e200, 0],
    [3e154, 4e154],
    [1e-170, 0],
    [3e-163, -4e-163],
  ] as const) {
    const refused = !(hypot2(direction[0], direction[1]) > 0)
    const spec = { direction, wavelength: 1, amplitude: 1, steepness: 0.5 }
    if (refused) assert.throws(() => new Waves([spec]), RangeError, `${direction}`)
    else assert.doesNotThrow(() => new Waves([spec]), `${direction}`)
  }
})
