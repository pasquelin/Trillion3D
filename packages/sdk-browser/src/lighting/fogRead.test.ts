// The surface's read of the fog volume (`./fog/readWgsl.ts`), run as shipped (`shaderRun`) over the
// view block of an image: the pixel and the slice it reads, the distance the analytic fog is left
// to, the volume laid over the fog, the sky's read, and the filters — one trilinear tap, four and
// eight cubic ones —; and its read of the cubemap, a cube texture asked by direction.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { cubemapMipCount } from '../../../sdk-core/src/scene/core/fogCubemap.ts'
import { sliceParams } from './fog/layout.ts'
import { fogResourcesWgsl } from './fog/readWgsl.ts'
import { CAM, EYE, image, sliceAtDepth, sub, viewBlockOf, type V3 } from './fogVolumeRun.fixture.ts'
import { RGB, fogRun, wgslFogged } from './fogShaderRun.fixture.ts'

/** A surface's read of the volume (`fogResourcesWgsl`): the volume a fake texture answering `found`,
 *  the view block of the image over the camera, the samples kept. */
function reading(
  volumetric: Parameters<typeof image>[1],
  settings: Parameters<typeof image>[2] = {},
  sample?: (uvw: number[]) => number[],
  trilinear = false,
) {
  const taps: number[][] = []
  const found = [0.1, 0.2, 0.3, 0.5]
  const fogView = viewBlockOf(image(CAM, volumetric, settings))
  const resources = {
    decl: fogResourcesWgsl({ group: 0, volume: 1, sampler: 2, trilinear }),
    scope: {
      fogVolume: {},
      fogSampler: {},
      textureSampleLevel: (_t: unknown, _s: unknown, uvw: number[]) => (
        taps.push(uvw),
        sample?.(uvw) ?? found
      ),
    },
  }
  return { taps, found, resources, fogView }
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
  const toward = sub(P, EYE)
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

/** The colour the fog's cubemap gives a ray of `span` metres in direction `ray` (`fogInscattering`):
 *  a scene whose cubemap is turned by `turn` degrees, the cube a fake texture asked through
 *  `answer` — which receives the direction and the level, and answers one value for all channels —,
 *  every ask kept. */
function cubeLook(
  turn: number,
  ray: V3,
  span: number,
  answer: (d: number[], level: number) => number,
) {
  const asked: { direction: number[]; level: number }[] = []
  const cube = { size: 4, texels: new Float32Array(6 * 16 * 3), turn }
  const run = fogRun<{ fogInscattering: (r: V3, d: number, sky: boolean) => number[] }>(
    { cubemap: cube },
    ['fogInscattering'],
    {
      resources: {
        decl: fogResourcesWgsl({ group: 0, cubemap: 1, sampler: 2 }),
        scope: {
          fogCubemap: {},
          fogSampler: {},
          textureSampleLevel: (_t: unknown, _s: unknown, direction: number[], level: number) => {
            asked.push({ direction: [...direction], level })
            const v = answer(direction, level)
            return [v, v, v, 1]
          },
        },
      },
    },
  )
  return { colour: run.fogInscattering(ray, span, false), asked }
}

test('the cubemap is a cube texture asked by direction: its sharpest level far away, its last level near, both between', () => {
  const levels = cubemapMipCount(4)
  const far = cubeLook(0, [1, 0.5, -2], 5000, (_d, level) => (level === 0 ? 0.8 : 0.2))
  assert.deepEqual(far.asked, [{ direction: [1, 0.5, -2], level: 0 }])
  near(far.colour, [0.8, 0.8, 0.8], 'sharp', 1e-6)
  const close = cubeLook(0, [1, 0.5, -2], 1, (_d, level) => (level === 0 ? 0.8 : 0.2))
  assert.deepEqual(close.asked, [{ direction: [1, 0.5, -2], level: levels }])
  near(close.colour, [0.2, 0.2, 0.2], 'average', 1e-6)
  // Between the two distances both are read and blended by the distance.
  const between = cubeLook(0, [1, 0, 0], 505, (_d, level) => (level === 0 ? 1 : 0))
  assert.deepEqual(between.asked.map((a) => a.level).sort(), [0, levels])
  near([between.colour[0]], [(505 - 10) / (1000 - 10)], 'blend', 1e-6)
})

test('the cubemap’s turn: a positive angle carries what lies ahead round to the right', () => {
  // The scene looks down −z with +x on its right. Turned a quarter, the cube's +x lies ahead — a ray
  // ahead reads it — and the cube's +z lies to the right.
  const ahead = cubeLook(90, [0, 0, -1], 5000, () => 1)
  near(ahead.asked[0].direction, [1, 0, 0], 'ahead reads +x', 1e-9)
  const right = cubeLook(90, [1, 0, 0], 5000, () => 1)
  near(right.asked[0].direction, [0, 0, 1], 'right reads +z', 1e-9)
  // Not turned, a ray reads its own direction.
  near(cubeLook(0, [0.3, 0.4, -0.5], 5000, () => 1).asked[0].direction, [0.3, 0.4, -0.5], 'none', 0)
})

/** What a seamless sampler gives at a cube's smallest level, one texel a face (`means`, the faces'
 *  `+x, −x, +y, −y, +z, −z`): the texel of the face the direction falls on, blended toward the face
 *  across each edge the direction nears by the share it has gone to it — the sampler reads the edge
 *  texel of the next face where the tap leaves its own. Valid where one other axis is off the face's. */
function seamless(means: number[], d: number[]) {
  const abs = d.map(Math.abs)
  const major = abs.indexOf(Math.max(...abs))
  const face = (axis: number) => axis * 2 + (d[axis] < 0 ? 1 : 0)
  let own = 1
  let across = 0
  for (let axis = 0; axis < 3; axis++) {
    if (axis === major) continue
    const share = abs[axis] / abs[major] / 2
    own -= share
    across += share * means[face(axis)]
  }
  return own * means[face(major)] + across
}

test('the cubemap’s average at 45° between two faces is the blend of their means, continuous across the seam', () => {
  const means = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
  const at = (angle: number) =>
    cubeLook(0, [Math.cos(angle), 0, Math.sin(angle)], 1, (d, level) =>
      level === 0 ? 0 : seamless(means, d),
    ).colour[0]
  const seam = Math.PI / 4
  // Face +x holds 0.1, face +z 0.5: on the seam, their mean — not either face's own.
  near([at(seam)], [0.3], 'the seam', 1e-6)
  near([at(0)], [0.1], 'mid-face', 1e-6)
  // A degree either side of the seam the colour moves a little — it does not jump to a face's constant.
  const step = Math.PI / 180
  assert.ok(Math.abs(at(seam + step) - at(seam - step)) < 0.02)
  assert.ok(at(seam - step) < at(seam) && at(seam) < at(seam + step))
})
