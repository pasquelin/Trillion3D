// Which pixels and lobes the reflections trace: the roughness bars, the clear coat, the roughness the rays take and the tile jitter of a block.
import test from 'node:test'
import assert from 'node:assert/strict'
import { reflectionTraceShader } from './trace/trace.ts'
import { SUBSURFACE_FLAG } from '../../materials/surface/subsurface.ts'
import { PIXEL_MODEL, PIXEL_MODEL_SHIFT } from '../../materials/surface/pixelModel.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { REFLECTION_PIXEL_TRACES_WGSL, REFLECTION_REACH_WGSL } from './reach.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../materials/surface/physicalLobes.ts'

/** The shipped `reflectionTraceShare` run with a roughness bar of 0.4 for a lobe, 0.2 for a foliage pixel's (`reach.z`), a band of 0.1. */
const traceShare = shaderRun<{ reflectionTraceShare: (alpha: number, flags: number) => number }>(
  wgslModule(REFLECTION_REACH_WGSL),
  ['reflectionTraceShare'],
  { reflectionView: { lobe: [0.4, 0.1, 0, 0], reach: [0, 0, 0.2, 0] } },
).reflectionTraceShare
const subsurfaceModelFlags = PIXEL_MODEL.subsurface << PIXEL_MODEL_SHIFT

test('a lobe traces up to its pixel’s bar: the foliage bar for the thin transmission’s models, the other for the rest', () => {
  const share = (rough: number, flags: number) => traceShare(rough * rough, flags)
  // Roughness 0.35 is within the lobe's band (half) and past the foliage bar; 0.15 is within the foliage band (half) and whole for a plain pixel.
  for (const [route, flags] of [
    ['the thin transmission’s flag', SUBSURFACE_FLAG],
    ['the subsurface pixel model', subsurfaceModelFlags],
  ] as const) {
    assert.ok(Math.abs(share(0.15, flags) - 0.5) < 1e-6, `${route}: half the band under 0.2`)
    assert.equal(share(0.35, flags), 0, `${route}: nothing past 0.2, whatever the lobe’s bar`)
  }
  assert.equal(share(0.15, 0), 1, 'a plain pixel: whole under 0.3')
  assert.ok(Math.abs(share(0.35, 0) - 0.5) < 1e-6, 'a plain pixel: half the band under 0.4')
  assert.equal(share(0.45, 0), 0, 'a plain pixel: nothing past 0.4')
  assert.ok(
    Math.abs(share(0.35, PIXEL_MODEL.skin << PIXEL_MODEL_SHIFT) - 0.5) < 1e-6,
    'a model beside the subsurface one keeps the lobe’s bar',
  )
})

test('a trace kernel asks each pixel whether it traces, then the share of each lobe', () => {
  const program = reflectionTraceShader(false)
  for (const call of [
    'own.flags)',
    ',flags)>0.0',
    'if(!reflectionPixelTraces(coord,flags)){return vec4u(0u);}',
  ])
    assert.ok(program.includes(call), call)
})

test('a pixel that carries a clear coat always traces, whatever its roughness; any other traces under its bar alone, a foliage pixel’s its own', () => {
  const traces = (coated: boolean, rough: number) =>
    shaderRun<{ reflectionPixelTraces: (coord: number[], flags: number) => boolean }>(
      wgslModule(REFLECTION_PIXEL_TRACES_WGSL),
      ['reflectionPixelTraces'],
      {
        surfaceCoatedAt: () => coated,
        surfaceNormalAt: () => [0, 0, 1, rough],
        reflectionView: { lobe: [0.4, 0.1, 0, 0], reach: [0, 0, 0.2, 0] },
        lobeAlpha: (r: number) => r * r,
      },
    ).reflectionPixelTraces
  assert.equal(traces(true, 0.9)([0, 0], 0), true, 'a coated pixel past the bar')
  assert.equal(traces(false, 0.9)([0, 0], 0), false, 'an uncoated one past the bar')
  assert.equal(traces(false, 0.2)([0, 0], 0), true, 'an uncoated one under it')
  assert.equal(traces(false, 0.3)([0, 0], 0), true, 'a plain pixel under 0.4')
  assert.equal(traces(false, 0.3)([0, 0], SUBSURFACE_FLAG), false, 'a foliage one past its 0.2')
  assert.equal(traces(false, 0.3)([0, 0], subsurfaceModelFlags), false, 'the subsurface model too')
})

test('the lobe a pixel traces has its roughness biased toward a mirror for the rays, and as the material gives it for the accumulation', () => {
  const lobes = (coated: boolean, bias: number) =>
    shaderRun<{
      surfaceTopRawAt: (coord: number[], flags: number) => number[]
      surfaceTopAt: (coord: number[], flags: number) => number[]
    }>(wgslModule(REFLECTION_SURFACES_WGSL), ['surfaceTopRawAt', 'surfaceTopAt'], {
      reflectionView: { lobe: [0.4, 0.1, 0, bias] },
      surfaceNormalAt: () => [0, 0, 2, 0.1],
      surfaceLobesAt: () => [0, 0, 1, 0],
      packedCoat: (w: number[]) => [coated && w[2] ? 1 : 0, 0.05],
      lobeOctDecode: () => [1, 0, 0],
    })
  const flags = PHYSICAL_SURFACE_FLAG
  // A smoothstep up to the bias: roughness 0.1 under a bias of 0.2 gives 0.1 · 0.25 · 2 = 0.05; the coat's 0.05 gives 0.05 · 0.0625 · 2.5.
  const plain = lobes(false, 0.2)
  assert.deepEqual(plain.surfaceTopRawAt([0, 0], flags), [0, 0, 1, 0.1])
  const biased = plain.surfaceTopAt([0, 0], flags)
  assert.ok(Math.abs(biased[3] - 0.1 * 0.25 * (3 - 2 * 0.5)) < 1e-6)
  assert.deepEqual(biased.slice(0, 3), [0, 0, 1])
  const coat = lobes(true, 0.2)
  assert.deepEqual(coat.surfaceTopRawAt([0, 0], flags), [1, 0, 0, 0.05])
  assert.ok(Math.abs(coat.surfaceTopAt([0, 0], flags)[3] - 0.05 * 0.0625 * (3 - 2 * 0.25)) < 1e-6)
  assert.equal(lobes(false, 0).surfaceTopAt([0, 0], flags)[3], 0.1, 'no bias, no change')
  // A pixel whose flags carry no physical lobes reads none: the coat of a stale texel is not traced.
  assert.deepEqual(coat.surfaceTopRawAt([0, 0], 0), [0, 0, 1, 0.1], 'no physical flag, no coat')
})

test('the tile jitter of a block turns with the frame index itself, the period of the ray directions (the turn) leaving it alone', () => {
  const jitter = (block: number[], g: number[], frame: number) =>
    shaderRun<{ reflectionJitter: (g: number[]) => number[] }>(
      wgslModule(REFLECTION_SURFACES_WGSL),
      ['reflectionJitter'],
      { reflectionBlock: () => block, reflectionView: { temporal: [0, 0, frame, 0] } },
    ).reflectionJitter(g)
  // Four rooks over four frames in a block of 2 × 2, the turn held at 0 throughout.
  const rooks = [0, 1, 2, 3, 4].map((frame) => jitter([2, 2], [0, 0], frame))
  assert.deepEqual(rooks, [
    [0, 1],
    [0, 0],
    [1, 1],
    [1, 0],
    [0, 1],
  ])
  // A checkerboard block (2 × 1): the column alternates with the frame and the row.
  assert.deepEqual(
    [0, 1, 2, 3].map((frame) => jitter([2, 1], [0, 0], frame)[0]),
    [0, 1, 0, 1],
  )
  assert.deepEqual(
    [0, 1].map((frame) => jitter([2, 1], [0, 1], frame)[0]),
    [1, 0],
  )
  // A block of one pixel across has none.
  assert.deepEqual(jitter([1, 1], [3, 3], 5), [0, 0])
})
