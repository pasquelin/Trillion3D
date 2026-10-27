// The reflections' last filter (`bilateralTop`, run in JavaScript by `shaderRun`) on a field of neighbours the test
// writes: when it filters, how a neighbour is weighed by its plane, its normal and its luminance, and the heavier
// tonemap its samples take while the pixel's history is new. The history's texels are told by the functions that
// read them (`texelRadiance`, `historyValid`, …), the surface by the ones that read the targets.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { REFLECTION_BILATERAL_WGSL } from './bilateralWgsl.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

type Vec3 = [number, number, number]
/** A history texel as the fake readers below tell it: its grey radiance, whether it holds, its luminance's second
 *  moment, its count. */
type Texel = [number, number, number, number]

interface Field {
  /** The pixel's own history, and every neighbour's. */
  own: Texel
  other: Texel
  /** The pixel's roughness, and the normal and the offset along the pixel's normal of every neighbour. */
  rough?: number
  normal?: Vec3
  lift?: number
  /** The images a history holds (`ReflectionView.denoise.x`), the disocclusion frames (`spread.w`). */
  frames?: number
  disocclusion?: number
  /** One tap of the disc for every neighbour, instead of the ring round the pixel, and the texels the neighbours are read at. */
  tap?: number[]
  read?: number[][]
}

const COORD = [32, 16]
const filtered = (f: Field) => {
  const run = shaderRun<{
    bilateralTop: (coord: number[], own: object, held: Texel, layer: number) => number[]
  }>(wgslModule(REFLECTION_BILATERAL_WGSL), ['bilateralTop'], {
    reflectionView: {
      denoise: [f.frames ?? 12, 1, 0.03, 10],
      spread: [8, 8, 0, f.disocclusion ?? 2],
      taps: [5, 4, 1024, 0],
      reach: [0, 0, 0, 10000],
    },
    reflectionDone: () => true,
    reflectionViewport: () => [64, 32],
    surfaceLinearDepth: () => 10,
    surfacePointAt: () => [0, 0, 10 + (f.lift ?? 0)],
    surfaceNormalAt: () => [...(f.normal ?? [0, 0, 1]), 0],
    bilateralIn: {},
    textureLoad: (_: object, at: number[]) => (f.read?.push(at), f.other),
    texelRadiance: (t: number[]) => [t[0], t[0], t[0]],
    historyValid: (t: number[]) => t[1] > 0,
    historyMoment: (t: number[]) => t[2],
    historyCount: (t: number[]) => t[3],
    reflectionDenoised: (c: number[]) => c,
    reflectionLinear: (c: number[]) => c,
    // Eight taps at 0.9 of the radius, round the pixel.
    reflectionReuseSeed: () => [0, 0],
    reflectionReuseTap: (k: number, taps: number) =>
      f.tap ?? [0.9 * Math.cos((2 * Math.PI * k) / taps), 0.9 * Math.sin((2 * Math.PI * k) / taps)],
  })
  const own = {
    P: [0, 0, 10],
    N: [0, 0, 1],
    V: [0, 0, 1],
    rough: f.rough ?? 0.5,
    top: f.rough ?? 0.5,
  }
  return run.bilateralTop(COORD, own, f.own, 0)[0]
}
const near = (a: number, b: number, what: string, tolerance = 1e-4) =>
  assert.ok(Math.abs(a - b) < tolerance, `${what}: ${a} against ${b}`)

/** A history of radiance `radiance`, its spread `spread`, `count` images held. */
const history = (radiance: number, spread: number, count: number): Texel => [
  radiance,
  1,
  radiance * radiance + spread * spread,
  count,
]

test('a converged, quiet pixel keeps its own history, and so does a mirror, whatever its spread', () => {
  near(filtered({ own: history(0.5, 0, 12), other: history(2, 0, 12) }), 0.5, 'quiet')
  near(
    filtered({ own: history(0.5, 0.9, 12), other: history(2, 0, 12), rough: 0.01 }),
    0.5,
    'a mirror: the radius is under a pixel',
  )
})

test('a noisy pixel mixes its neighbours by luminance: a neighbour as far as the spread weighs half', () => {
  // A neighbour 1.5 from the pixel's luminance, twice the spread: a quarter.
  const spread = 0.75
  const weight = 2 ** (-(2 - 0.5) / spread)
  near(
    filtered({ own: history(0.5, spread, 12), other: history(2, 0, 12) }),
    (0.5 + 4 * weight * 2) / (1 + 4 * weight),
    'four taps, no disocclusion',
  )
})

test('a new history takes twice the neighbours, whole, in a heavier tonemap that keeps a firefly from lighting them', () => {
  // Disocclusion 1: eight neighbours, the luminance weight gone, each sample L / (1 + L), the mean turned back.
  const tonemapped = (0.5 / 1.5 + (8 * 2) / 3) / 9
  near(
    filtered({ own: history(0.5, 0, 0), other: history(2, 0, 0) }),
    tonemapped / (1 - tonemapped),
    'a quiet pixel with no image yet',
  )
  const firefly = filtered({ own: history(0.5, 0, 0), other: history(1000, 0, 0) })
  // The plain mean of the nine samples would be 889.
  assert.ok(firefly < 20, `a thousandfold neighbour counts as a bright one: ${firefly}`)
})

test('the boost is off where the setting is zero or the history holds a single image', () => {
  near(filtered({ own: history(0.5, 0, 0), other: history(2, 0, 0), disocclusion: 0 }), 0.5, 'zero')
  near(filtered({ own: history(0.5, 0, 0), other: history(2, 0, 0), frames: 1 }), 0.5, 'one image')
})

test('a neighbour off the pixel’s plane weighs nothing: the gaussian of its distance over the depth', () => {
  near(
    filtered({ own: history(0.5, 0, 0), other: history(2, 0, 0), lift: 1000 }),
    0.5,
    'a hundred depths off',
  )
  // A hair off the plane keeps nearly its whole weight: (0.001 / 10)² × 10000 = 10⁻⁴.
  const hair = filtered({ own: history(0.5, 0, 0), other: history(2, 0, 0), lift: 0.001 })
  const flat = filtered({ own: history(0.5, 0, 0), other: history(2, 0, 0) })
  near(hair, flat, 'a hair', 1e-3)
})

test('a neighbour whose normal turns past the lobe’s half angle weighs nothing, a slight one is weighed down', () => {
  // Roughness 0.5: the half angle atan(3 · 0.25) + 0.01 = 0.6535 radian; no disocclusion.
  const field = (tilt: number) =>
    filtered({
      own: history(0.5, 0.9, 12),
      other: history(2, 0, 12),
      normal: [Math.sin(tilt), 0, Math.cos(tilt)],
    })
  const aligned = field(0)
  const slight = field(0.3)
  assert.ok(aligned > slight && slight > 0.5, `weighed down: ${aligned} > ${slight} > 0.5`)
  near(field(0.8), 0.5, 'past the half angle')
})

test('a neighbour is the pixel plus the tap’s offset and a half, cut to a whole number toward zero: an offset of −1.5 reads the pixel 1 to the left', () => {
  const read: number[][] = []
  // Roughness 0.5: the radius is 8; the tap (−0.1875, 0.0625) is the offset (−1.5, 0.5), the pixel (32, 16) the neighbour (31, 17).
  filtered({ own: history(0.5, 0.9, 12), other: history(2, 0, 12), tap: [-0.1875, 0.0625], read })
  assert.ok(read.length > 0)
  assert.deepEqual(
    read.map(([x, y]) => [x, y]),
    read.map(() => [31, 17]),
  )
})

test('the neighbours read are the taps of the setting raised by the disocclusion and rounded by half: 4 to 8 at 0.4 is 5.6, six', () => {
  const read: number[][] = []
  // Two frames of disocclusion and 1.2 images held: a disocclusion of 0.4.
  filtered({ own: history(0.5, 0, 1.2), other: history(2, 0, 12), read })
  assert.equal(read.length, 6)
})

/** The pass's blend and shares (`bilateralBlended`, `bilateralShares`), the roughness's share of a ray standing as `1 − α`. */
const blend = (lobes: { on: boolean; coat: number }) =>
  shaderRun<{
    bilateralBlended: (seen: object) => { base: Vec3; coat: Vec3 }
    bilateralShares: (own: object) => number[]
  }>(wgslModule(REFLECTION_BILATERAL_WGSL), ['bilateralBlended', 'bilateralShares'], {
    lobes,
    lobeAlpha: (rough: number) => rough * rough,
    reflectionSmoothed: (rough: number) => rough,
    reflectionTraceShare: (alpha: number) => Math.max(0, 1 - alpha),
  })

test('the ray of a coated pixel answers its coat whole and its base lobe not at all, whatever their roughnesses; a bare lobe answers the share its roughness gives it', () => {
  const own = { rough: 0.5, top: 0.1, flags: 0 }
  const coated = blend({ on: true, coat: 0.5 }).bilateralShares(own)
  assert.deepEqual(coated, [0, 1], 'the coat whole, the base lobe under it the rough light alone')
  // A smooth base lobe under a rough coat, the other way round: still the coat's ray whole and none for the base.
  assert.deepEqual(
    blend({ on: true, coat: 0.5 }).bilateralShares({ rough: 0.01, top: 0.9, flags: 0 }),
    [0, 1],
    'neither roughness changes it',
  )
  const bare = blend({ on: false, coat: 0 }).bilateralShares(own)
  near(bare[0], 1 - 0.25, 'a bare lobe')
  assert.equal(bare[1], 0, 'no coat, no share')
  // The environment through the base lobe is the rough light of both lobes: the coat's rest reads it, not an environment of its own.
  const seen = {
    ray: [1, 1, 1],
    field: [0.5, 0.5, 0.5],
    share: [0.25, 0.5],
  }
  const mixed = blend({ on: true, coat: 0.5 }).bilateralBlended(seen)
  assert.deepEqual(mixed.base, [0.625, 0.625, 0.625], 'a quarter ray, three quarters environment')
  assert.deepEqual(
    mixed.coat,
    [0.75, 0.75, 0.75],
    'a coat the ray answers in half, the environment through the base lobe the rest',
  )
  const whole = blend({ on: true, coat: 0.5 }).bilateralBlended({ ...seen, share: [0, 1] })
  assert.deepEqual(whole.coat, [1, 1, 1], 'a coat the ray answers whole')
  const field = blend({ on: false, coat: 0 }).bilateralBlended({
    ...seen,
    ray: [0, 0, 0],
    share: [0, 0],
  })
  assert.deepEqual(
    [field.base, field.coat],
    [
      [0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
    ],
    'no history: the environment alone, for both lobes',
  )
})

test('the opaque pass writes the environment through the base lobe for every pixel, the share of the coat’s lobe the rays leave in its alpha only for a pixel that carries a coat', () => {
  const text = wgslSource(REFLECTION_BILATERAL_WGSL)
  const writes = [
    ...text.matchAll(
      /textureStore\(reflectionOut,coord,1,vec4f\(seen\.field,select\(0\.0,1\.0-seen\.share\.y,hasCoat\(\)\)\)\)/g,
    ),
  ].length
  assert.equal(writes, 2, 'the opaque resolve and clear entries write it')
  assert.equal(
    [...text.matchAll(/textureStore\(reflectionOut,coord,\d,/g)].length,
    4,
    'two layers in each of the two entries, nothing weighed in either',
  )
})
