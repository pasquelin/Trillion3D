// #1335, #1336: the impostor card reads the octahedral atlas with ONE arithmetic, the library's
// (`octEncodeHemi`, `octDecodeHemi`), the one the compiler's `octahedron.rs` bakes the atlas with.
// The tests run the shipped shader text itself through the software shader harness, on the places
// and folds the compiler's own tests pin.
import test from 'node:test'
import assert from 'node:assert/strict'
import { IMPOSTOR_CARD_WGSL } from './impostorWgsl.ts'
import { runShaderText } from './shaderText.fixture.ts'
import { functionsOf } from '../../texture/shaderRule.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'

/** The card's functions, as the software harness runs them. */
const shaderOf = (name: string) => functionsOf(wgslModule(IMPOSTOR_CARD_WGSL), [name])
const octSide = runShaderText<number>(shaderOf('octSide'))
const run = {
  encode: runShaderText<number[]>(shaderOf('octEncodeHemi'), { octSide }),
  decode: runShaderText<number[]>(shaderOf('octDecodeHemi'), { octSide }),
  weights: runShaderText<number[]>(shaderOf('impWeights')),
}
const encode = (direction: number[], hemi: boolean) => run.encode(direction, hemi ? 1 : 0)
const decode = (grid: number[], hemi: boolean) => run.decode(grid, hemi ? 1 : 0)

// The three-frame weights are the barycentric coordinates of the position in its cell's triangle,
// as #817's compiler test proves: they sum to one and rebuild the position.
test('the card weights sum to one and are the barycentric coordinates of the cell', () => {
  for (const [fx, fy] of [
    [0.1, 0.2],
    [0.9, 0.4],
    [0.5, 0.5],
    [0.0, 0.75],
    [0.33, 0.66],
  ]) {
    const [first, middle, last] = run.weights([fx, fy]),
      corner = fx > fy ? [1, 0] : [0, 1]
    for (const weight of [first, middle, last]) assert.ok(weight >= 0 && weight <= 1)
    near(
      [first + middle + last, middle * corner[0] + last, middle * corner[1] + last],
      [1, fx, fy],
      `${fx},${fy}`,
      1e-12,
    )
  }
})

test('the world axes land on their places of the plane and decode back from the grid', () => {
  const landmarks = [
    { hemi: false, direction: [1, 0, 0], plane: [1, 0], grid: [1, 0.5] },
    { hemi: false, direction: [-1, 0, 0], plane: [-1, 0], grid: [0, 0.5] },
    { hemi: false, direction: [0, 1, 0], plane: [0, 0], grid: [0.5, 0.5] },
    // Straight down sits on the +,+ corner: the fold gives an axis the side `+1`, never 0.
    { hemi: false, direction: [0, -1, 0], plane: [1, 1], grid: [1, 1] },
    { hemi: false, direction: [0, 0, 1], plane: [0, 1], grid: [0.5, 1] },
    { hemi: false, direction: [0, 0, -1], plane: [0, -1], grid: [0.5, 0] },
    { hemi: true, direction: [1, 0, 0], plane: [1, -1], grid: [1, 0] },
    { hemi: true, direction: [-1, 0, 0], plane: [-1, 1], grid: [0, 1] },
    { hemi: true, direction: [0, 1, 0], plane: [0, 0], grid: [0.5, 0.5] },
    { hemi: true, direction: [0, 0, 1], plane: [1, 1], grid: [1, 1] },
    { hemi: true, direction: [0, 0, -1], plane: [-1, -1], grid: [0, 0] },
  ]
  for (const { hemi, direction, plane, grid } of landmarks) {
    near(encode(direction, hemi), plane, `encode ${direction} hemi ${hemi}`, 0)
    near(decode(grid, hemi), direction, `decode ${grid} hemi ${hemi}`, 1e-14)
  }
})

test('the plane point depends on the direction alone, and the equator lies on the upper face', () => {
  for (const hemi of [false, true])
    for (const direction of [
      [1, -1, 0],
      [-3, -2, 5],
      [2, 1, -1],
    ])
      for (const scale of [2 ** -1000, 2 ** 1000])
        near(
          encode(
            direction.map((value) => value * scale),
            hemi,
          ),
          encode(direction, hemi),
          `${direction} × ${scale} hemi ${hemi}`,
          0,
        )
  // The fold of the lower face would round these equator points otherwise than the upper face.
  for (const [x, z] of [
    [1, 2],
    [-3, 1],
    [-1.9, 0.9],
  ])
    near(encode([x, 0, z], false), encode([x, 1e-300, z], false), `${x}, ${z}`, 0)
})

test('the upper hemi-octahedron folds a direction below the horizon onto it', () => {
  for (const [x, z] of [
    [1, 1],
    [-2, 0.5],
    [0, -3],
  ])
    near(encode([x, -4, z], true), encode([x, 0, z], true), `${x}, ${z}`, 0)
})

// Straight down on the hemi-octahedron and no direction at all have no part on the map's
// octahedron: they read the zenith frame, as the compiler's `octahedral_encode` defines, never NaN.
test('a direction with no part on the octahedron reads the zenith frame', () => {
  for (const [direction, hemi] of [
    [[0, -1, 0], true],
    [[0, -(2 ** 1000), 0], true],
    [[0, 0, 0], true],
    [[0, 0, 0], false],
  ] as const)
    near(encode([...direction], hemi), [0, 0], `${direction} hemi ${hemi}`, 0)
})

test('atlas encode/decode round trips preserve directions across both folds and quadrants', () => {
  for (const hemi of [false, true])
    for (const x of [-3, -1, 0, 2, 5])
      for (const y of hemi ? [0, 1, 4] : [-4, -1, 0, 1, 4])
        for (const z of [-5, -2, 0, 1, 3]) {
          const length = Math.hypot(x, y, z)
          if (!length) continue
          const encoded = encode([x, y, z], hemi)
          assert.ok(encoded.every((value) => value >= -1 && value <= 1))
          const decoded = decode(
            encoded.map((value) => (value + 1) / 2),
            hemi,
          )
          near(decoded, [x / length, y / length, z / length], `${[x, y, z]} hemi ${hemi}`, 1e-14)
        }
})
