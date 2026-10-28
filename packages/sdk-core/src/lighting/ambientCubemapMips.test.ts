// The ambient cubemap's mip chain (`ambientCubemapMips.ts`, filtered by the reference `ambientCubemapMips.fixture.ts`): the sizes of the chain, a uniform cube staying uniform at every mip, the
// last mips holding the cube convolved by the hemisphere (a lit upper half-space gives its pole and its opposite pole
// shares that sum to the whole), and the first mip staying close to the cube.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mipSize } from '../../../math/src/scalar/integers.ts'
import { cubemapMipCount } from '../scene/core/fogCubemap.ts'
import { AMBIENT_CUBEMAP_DIFFUSE_MIP } from './ambientCubemapMips.ts'
import { ambientCubemapMipRows, prepareAmbientCubemap } from './ambientCubemapMips.fixture.ts'

const SIZE = 32
/** The cube's mip chain, whole: mip `i` is `6 · side² · 3` numbers, each face filtered in one go. */
function ambientCubemapMips(cube: { size: number; texels: ArrayLike<number> }) {
  const prepared = prepareAmbientCubemap(cube)
  return prepared.averaged.map((_, level) => {
    const side = mipSize(cube.size, level)
    const mip = new Float32Array(6 * side * side * 3)
    const face = new Float32Array(side * side * 3)
    for (let k = 0; k < 6; k++) {
      ambientCubemapMipRows(prepared, level, k, 0, side, face)
      mip.set(face, k * side * side * 3)
    }
    return mip
  })
}
const cubeOf = (value: (face: number, x: number, y: number) => number) => {
  const texels = new Float32Array(6 * SIZE * SIZE * 3)
  for (let face = 0; face < 6; face++)
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++)
        texels.fill(
          value(face, x, y),
          ((face * SIZE + y) * SIZE + x) * 3,
          ((face * SIZE + y) * SIZE + x) * 3 + 3,
        )
  return { size: SIZE, texels }
}

/** The channel of the texel at the middle of a face of mip `side`: the texel itself where the face has one, else the mean of the four around the middle. */
const middle = (mip: Float32Array, side: number, face: number) => {
  if (side === 1) return mip[face * 3]
  const half = side >> 1
  let sum = 0
  for (const [x, y] of [
    [half - 1, half - 1],
    [half, half - 1],
    [half - 1, half],
    [half, half],
  ])
    sum += mip[((face * side + y) * side + x) * 3]
  return sum / 4
}

test('the chain has a mip for each halving of the side, down to one texel', () => {
  assert.equal(cubemapMipCount(32), 6)
  const mips = ambientCubemapMips(cubeOf(() => 0.25))
  assert.equal(mips.length, 6)
  mips.forEach((mip, level) => assert.equal(mip.length, 6 * (32 >> level) ** 2 * 3))
})

test('a uniform cube is uniform at every mip', () => {
  for (const mip of ambientCubemapMips(cubeOf(() => 0.25)))
    for (const value of mip) assert.ok(Math.abs(value - 0.25) < 1e-5, `${value}`)
})

test('the first mip is the cube a little blurred: a lit face stays lit at its middle, the opposite one dark', () => {
  // The +y face lit, the others dark: the lit face's middle stays near one at the first mip.
  const cube = cubeOf((face) => (face === 2 ? 1 : 0))
  const [first] = ambientCubemapMips(cube)
  assert.ok(middle(first, SIZE, 2) > 0.95)
  assert.ok(middle(first, SIZE, 3) < 1e-6)
})

test('the last mips hold the cube convolved by the hemisphere: opposite poles of a lit hemisphere share the whole', () => {
  // The directions above the horizon of +y lit (faces: the +y face, and the upper half of the four side faces).
  const cube = cubeOf((face, x, y) => {
    if (face === 2) return 1
    if (face === 3) return 0
    // The side faces' rows from the top: the upper half looks toward +y.
    return y < SIZE / 2 ? 1 : 0
  })
  const mips = ambientCubemapMips(cube)
  // The mip four above the last, the one the diffuse light is read at: 8 texels a side.
  const level = mips.length - AMBIENT_CUBEMAP_DIFFUSE_MIP
  const side = SIZE >> level
  const up = middle(mips[level], side, 2),
    down = middle(mips[level], side, 3)
  assert.ok(up > 0.6 && down < 0.4, `${up} ${down}`)
  assert.ok(Math.abs(up + down - 1) < 2e-3, `${up} + ${down}`)
})

test('a face filtered in two halves is the face filtered whole, whatever the cut', () => {
  const cube = cubeOf((face, x, y) => ((face * 7 + x * 3 + y * 5) % 11) / 11)
  const prepared = prepareAmbientCubemap(cube)
  const side = SIZE >> 1,
    whole = new Float32Array(side * side * 3)
  ambientCubemapMipRows(prepared, 1, 3, 0, side, whole)
  const joined = new Float32Array(side * side * 3)
  const rows = new Float32Array(side * 3 * 5)
  for (let first = 0; first < side; first += 5) {
    const count = Math.min(5, side - first)
    ambientCubemapMipRows(prepared, 1, 3, first, count, rows)
    joined.set(rows.subarray(0, count * side * 3), first * side * 3)
  }
  assert.deepEqual(joined, whole)
})
