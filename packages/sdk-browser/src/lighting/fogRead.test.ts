// The surface's read of the fog volume (`./fog/readWgsl.ts`), run as shipped (`shaderRun`) over the
// view block of an image: the pixel and the slice it reads, the distance the analytic fog is left
// to, the volume laid over the fog, the sky's read, and the filters — one trilinear tap, four and
// eight cubic ones. Its read of the cubemap is `fogCubemapRead.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { subtract } from '../../../math/src/vector/vectorTuple.ts'
import { sliceParams } from './fog/layout.ts'
import { fogBlockOf } from './fog/readWgsl.ts'
import { CAM, EYE, image, sliceAtDepth, viewBlockOf, type V3 } from './fogVolumeRun.fixture.ts'
import { RGB, fogRun, wgslFogged } from './fogShaderRun.fixture.ts'

/** The hash the read jitter draws from: three 16-bit words of a 3D integer point, in wrapping
 *  integer arithmetic (the run's vectors do not wrap). */
function hash16(p: number[]) {
  const step = (a: number, b: number, c: number) => (a + Math.imul(b, c)) >>> 0
  const v = p.map((c) => (Math.imul(c, 1664525) + 1013904223) >>> 0)
  for (let round = 0; round < 2; round++) {
    v[0] = step(v[0], v[1], v[2])
    v[1] = step(v[1], v[2], v[0])
    v[2] = step(v[2], v[0], v[1])
  }
  return v.map((word) => word >>> 16)
}

/** A surface's read of the volume (`fogBlockOf`): the volume a fake texture answering `found`,
 *  the view block of the image over the camera, the samples kept, the points hashed. */
function reading(
  volumetric: Parameters<typeof image>[1],
  settings: Parameters<typeof image>[2] = {},
  sample?: (uvw: number[]) => number[],
  translucent = false,
  more: Parameters<typeof image>[3] = {},
) {
  const taps: number[][] = []
  const hashed: number[][] = []
  const found = [0.1, 0.2, 0.3, 0.5]
  const fogView = viewBlockOf(image(CAM, volumetric, settings, more))
  const resources = {
    block: fogBlockOf({ group: 0, volume: 1, sampler: 2, translucent }),
    scope: {
      fogVolume: {},
      fogSampler: {},
      rand3dPcg16: (p: number[]) => (hashed.push(p), hash16(p)),
      textureSampleLevel: (_t: unknown, _s: unknown, uvw: number[]) => (
        taps.push(uvw),
        sample?.(uvw) ?? found
      ),
    },
  }
  return { taps, hashed, found, resources, fogView }
}
const READ_FOG = { baseDensity: 0.01, falloff: 0, volumetric: { reach: 20, startAt: 4 } }
type Lookup = { fogVolumeLookup: (toward: number[]) => number[] }

test('a surface reads the volume at its pixel and its depth, the fog before it left to the analytic law', () => {
  const { taps, found, resources, fogView } = reading(READ_FOG.volumetric)
  const run = fogRun<Lookup & { fogVolumeExclude: (v: number[]) => number }>(
    READ_FOG,
    ['fogVolumeExclude', 'fogVolumeLookup'],
    { resources, fogView },
  )
  // The volume covers 24 m of view depth: along a ray, that over the cosine to the forward.
  const ray = [3, 0, -10]
  const cosine = 10 / Math.hypot(...ray)
  near([run.fogVolumeExclude(ray)], [24 / cosine], 'exclude', 1e-5)
  assert.equal(run.fogVolumeExclude([0, 0, 5]), 0)
  // A ray the view's plane barely leaves has the volume's end projected a long way along it, as far as a
  // thousandth of cosine allows (cosine 2·10⁻³); within it of the plane, at it, or behind it, none.
  const grazing = [1, 0, -2e-3]
  near(
    [run.fogVolumeExclude(grazing) / (24 / (2e-3 / Math.hypot(...grazing)))],
    [1],
    'grazing',
    1e-3,
  )
  assert.equal(run.fogVolumeExclude([1, 0, -5e-4]), 0)
  assert.equal(run.fogVolumeExclude([1, 0, 0]), 0)
  // The point at view depth 10: its pixel and its slice of the volume that starts at 4 m.
  const toward = [2, 1, -10]
  near(run.fogVolumeLookup(toward), found, 'found', 0)
  const p = sliceParams(4, 24, 32, 8)
  const ndc = [toward[0] / (10 * CAM.half[0]), toward[1] / (10 * CAM.half[1])]
  const uv = [ndc[0] * 0.5 + 0.5, 0.5 - ndc[1] * 0.5]
  near(taps[0], [uv[0], uv[1] * (90 / 96), sliceAtDepth(10, p) / 8], 'where', 1e-5)
  // Nearer than the start, the volume has nothing to give.
  near(run.fogVolumeLookup([0, 0, -3]), [0, 0, 0, 1], 'before the start', 0)
})

test('a pass that draws the whole image reads the volume at its pixel, a translucent layer at its place in the view', () => {
  const toward = [2, 1, -10]
  const read = (translucent: boolean) => {
    const r = reading(READ_FOG.volumetric, {}, undefined, translucent)
    fogRun<Lookup>(READ_FOG, ['fogVolumeLookup'], {
      resources: r.resources,
      fogView: r.fogView,
    }).fogVolumeLookup(toward)
    return r.taps[0]
  }
  const ndc = [toward[0] / (10 * CAM.half[0]), toward[1] / (10 * CAM.half[1])]
  const uv = [ndc[0] * 0.5 + 0.5, 0.5 - ndc[1] * 0.5]
  // 160 × 90 pixels in 20 × 12 cells of 8: the cells overhang the view by 90 / 96 down. The image
  // reads at its pixel (the view's share of the cells), a translucent layer at the view's own
  // coordinate (the cells spread over it).
  near(read(false).slice(0, 2), [uv[0], uv[1] * (90 / 96)], 'the pixel', 1e-5)
  near(read(true).slice(0, 2), uv, 'the place in the view', 1e-5)
  // A view drawn smaller than the textures: its 15 × 9 cells are the share 15 / 20 and 9 / 12 of them.
  const textures = image(CAM).grid
  const smaller = { grid: { ...textures, x: 15, y: 9 }, resource: textures }
  const r = reading(READ_FOG.volumetric, {}, undefined, true, smaller)
  fogRun<Lookup>(READ_FOG, ['fogVolumeLookup'], {
    resources: r.resources,
    fogView: r.fogView,
  }).fogVolumeLookup(toward)
  near(r.taps[0].slice(0, 2), [uv[0] * 0.75, uv[1] * 0.75], 'the share of the textures', 1e-5)
})

test('the read jitter moves a pixel’s read by the hash of the pixel and of the image, in cells', () => {
  const toward = [2, 1, -10]
  const jitter = 3
  const run = (settings: Parameters<typeof image>[2], translucent = false, more = {}) => {
    const r = reading(READ_FOG.volumetric, settings, undefined, translucent, more)
    fogRun<Lookup>(READ_FOG, ['fogVolumeLookup'], {
      resources: r.resources,
      fogView: r.fogView,
    }).fogVolumeLookup(toward)
    return r
  }
  const plain = run({})
  const jittered = run({ volumetricFogReadJitter: jitter })
  // The pixel of the point (160 × 90) and the image's number are what is hashed.
  const uv = [(2 / (10 * CAM.half[0])) * 0.5 + 0.5, 0.5 - (1 / (10 * CAM.half[1])) * 0.5]
  assert.deepEqual(jittered.hashed, [[Math.floor(uv[0] * 160), Math.floor(uv[1] * 90), 0]])
  assert.deepEqual(plain.hashed, [], 'no hash where the jitter is 0')
  // The offset is the hash in [−1, 1] times the cells asked (8 pixels each), over the extent of the
  // cells' pixels.
  const words = hash16(jittered.hashed[0])
  const extent = [160, 96]
  const want = [0, 1].map((k) => ((words[k] / 65535) * 2 - 1) * ((jitter * 8) / extent[k]))
  const moved = [0, 1].map((k) => jittered.taps[0][k] - plain.taps[0][k])
  near(moved, want, 'moved', 1e-5)
  assert.ok(
    want.every((w) => w !== 0 && Math.abs(w) < 1),
    `${want}`,
  )
  // The same pixel of the same image reads the same place; another image's number moves it.
  assert.deepEqual(run({ volumetricFogReadJitter: jitter }).taps[0], jittered.taps[0])
  const later = run({ volumetricFogReadJitter: jitter }, false, { frameIndex: 3 })
  assert.equal(later.hashed[0][2], 3)
  assert.notDeepEqual(later.taps[0], jittered.taps[0])
  // A translucent layer reads without it.
  const layer = run({ volumetricFogReadJitter: jitter }, true)
  assert.deepEqual(layer.hashed, [])
  near(
    layer.taps[0].slice(0, 2),
    [plain.taps[0][0], plain.taps[0][1] / (90 / 96)],
    'unjittered',
    1e-5,
  )
})

test('a ray that leaves the scene reads the last slice at its direction’s pixel, the fog through it', () => {
  const { taps, found, resources, fogView } = reading(READ_FOG.volumetric)
  type Beyond = { fogBeyond: (dir: number[], eye: number[]) => number[] }
  const dir = [2, 1, -10].map((c) => c / Math.hypot(2, 1, -10))
  const beyond = fogRun<Beyond>(READ_FOG, ['fogBeyond'], { resources, fogView }).fogBeyond(dir, EYE)
  const uv = [(2 / (10 * CAM.half[0])) * 0.5 + 0.5, 0.5 - (1 / (10 * CAM.half[1])) * 0.5]
  near(taps[0].slice(0, 2), [uv[0], uv[1] * (90 / 96)], 'sky pixel', 1e-5)
  assert.ok(taps[0][2] > 1, 'past the last slice, where the sampler holds the last')
  // The volume's light over the analytic fog of the whole way, itself seen through the volume.
  const without = fogRun<Beyond>(READ_FOG, ['fogBeyond'], {}).fogBeyond(dir, EYE)
  near(
    beyond,
    [0, 1, 2].map((c) => found[c] + without[c] * found[3]).concat(without[3] * found[3]),
    'stacked',
    1e-6,
  )
})

test('the volume lies over the fog: its light, and the fog through what it lets through; the analytic fog starts past it', () => {
  const { found, resources, fogView } = reading(READ_FOG.volumetric)
  const P: V3 = [2, 2.5, -50]
  const toward = subtract(P, EYE)
  const cosine = -toward[2] / Math.hypot(...toward)
  const exclude = 24 / cosine
  // Analytic fog from where the volume ends; the volume's light plus that through its transmittance.
  const analytic = wgslFogged(
    { baseDensity: 0.01, falloff: 0, startDistance: exclude },
    RGB,
    P,
    EYE,
  )
  const want = analytic.map((v, c) => found[c] + v * found[3])
  near(wgslFogged(READ_FOG, RGB, P, EYE, { resources, fogView }), want, 'stacked', 1e-6)
  // A volume that is not built for the image (the view block zero) leaves the fog whole.
  near(
    wgslFogged(READ_FOG, RGB, P, EYE, { resources, fogView: viewBlockOf(image(CAM), false) }),
    wgslFogged({ baseDensity: 0.01, falloff: 0 }, RGB, P, EYE),
    'not built',
    1e-9,
  )
})

test('the filter of the read: one trilinear tap, four and eight cubic ones through the volume’s texels', async () => {
  const taps = (filtering: 'trilinear' | 'bicubic' | 'tricubic', trilinear = false) => {
    const r = reading(
      READ_FOG.volumetric,
      { volumetricFogReadFilter: filtering },
      undefined,
      trilinear,
    )
    const run = fogRun<Lookup>(READ_FOG, ['fogVolumeLookup'], {
      resources: r.resources,
      fogView: r.fogView,
    })
    near(run.fogVolumeLookup([2, 1, -10]), r.found, `${filtering} of a flat volume`, 1e-6)
    return r.taps.length
  }
  assert.deepEqual([taps('trilinear'), taps('bicubic'), taps('tricubic')], [1, 4, 8])
  // The translucent layers read it trilinear whatever the run names: their program has no cubic filter.
  assert.deepEqual([taps('bicubic', true), taps('tricubic', true)], [1, 1])
})

test('the cubic read filters the depth through the second tap of its slice, the plane of the screen through the first', () => {
  // A volume that depends on the depth alone, by its square: the cubic B-spline weights, written out.
  const ramp = (uvw: number[]) => [uvw[2] * uvw[2], 0, 0, 1]
  const read = (filtering: 'bicubic' | 'tricubic') => {
    const r = reading(READ_FOG.volumetric, { volumetricFogReadFilter: filtering }, ramp)
    const run = fogRun<Lookup>(READ_FOG, ['fogVolumeLookup'], {
      resources: r.resources,
      fogView: r.fogView,
    })
    return run.fogVolumeLookup([2, 1, -10])[0]
  }
  const z = sliceAtDepth(10, sliceParams(4, 24, 32, 8)) / 8
  const at = z * 8 + 0.5
  const [floor, g] = [Math.floor(at), at - Math.floor(at)]
  const o = 1 - g
  const w = [
    (o * o * o) / 6,
    2 / 3 - 0.5 * g * g * (2 - g),
    2 / 3 - 0.5 * o * o * (2 - o),
    (g * g * g) / 6,
  ]
  const [g0, g1] = [w[0] + w[1], w[2] + w[3]]
  const second = (w[3] / g1 + 0.5 + floor) / 8
  near([read('bicubic')], [z * z], 'bicubic reads the depth at the point', 1e-6)
  near([read('tricubic')], [g0 * z * z + (1 - g0) * second * second], 'tricubic filters it', 1e-6)
})
