// The projection's screen ray (`vsmScreenRayStart`, `vsmScreenRayFrom`): four point samples of the
// opaque depth along the ray,
// dithered by the pixel's noise, the start pixel's own depth skipped. Shipped WGSL run as JavaScript
// over a depth image seen by an orthographic view whose world is its NDC: a ray reads five texels
// whatever its length, the first sample behind the depth ends it a step and a half back, a sample
// on the receiver's own depth and a transparent surface are no occluders.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { Mat } from '../texture/shaderRunMatrix.fixture.ts'
import {
  depthField,
  depthImage,
  depthLoads,
  HIZ_DEPTH_READERS,
} from '../reflections/depthField.fixture.ts'
import { CODE, constructors } from './pageWorld.fixture.ts'
import { HIZ_DEPTH_LAYERS } from '../gpu/hiz/pyramidTexture.ts'

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const W = 128,
  H = 64

/** The shipped cast over the depth image `depth` (and the transparent layer `front`), `W × H`, in a
 *  view whose NDC is its world; it counts the depth texels it reads. */
function caster(
  depth: (x: number, y: number) => number,
  front: (x: number, y: number) => number = () => 0,
) {
  const field = depthField(W, H, depthImage(W, H, depth), depthImage(W, H, front))
  const token = { depth: { layers: HIZ_DEPTH_LAYERS }, pyramid: {} }
  const counter = { loads: 0 }
  const load = depthLoads(field, token, () => {})
  const run = shaderRun<{
    vsmScreenRayStart: (o: number[]) => object
    vsmScreenRayFrom: (
      s: object,
      o: number[],
      d: number[],
      length: number,
      dither: number,
    ) => number
  }>(
    CODE,
    [
      'vsmScreenRayStart',
      'vsmScreenRayFrom',
      'clipToFramebuffer',
      'perspectiveDivide',
      'ndcToPixel',
      ...HIZ_DEPTH_READERS,
    ],
    {
      vsmView: {
        shiftedToClip: new Mat(IDENTITY),
        viewPixels: [W, H, 1 / W, 1 / H],
      },
      hizDepth: token.depth,
      hizPyramid: token.pyramid,
      hizLevels: field.levels,
      ...constructors(CODE),
      textureLoad: (t: object, cell: number[], layer: number) => {
        if (t === token.depth) counter.loads++
        return load(t, cell, layer)
      },
    },
  )
  const cast = (o: number[], d: number[], length: number, dither: number) =>
    run.vsmScreenRayFrom(run.vsmScreenRayStart(o), o, d, length, dither)
  return { cast, counter }
}

/** The NDC of the centre of pixel `(x, y)`. */
const ndc = (x: number, y: number) => [((x + 0.5) / W) * 2 - 1, 1 - ((y + 0.5) / H) * 2]
/** A ray from pixel (64, 32)'s centre, 32 pixels along +x, its depth falling from 0.5 to 0.4. */
const O = [...ndc(64, 32), 0.5]
const D = [(32 * 2) / W, 0, -0.1]

test('a ray in front of everything reads the start and four samples, whatever its length', () => {
  for (const pixels of [4, 32, 100]) {
    const { cast, counter } = caster(() => 0.1)
    assert.equal(cast(O, [(pixels * 2) / W, 0, -0.1], 1, 0.5), 1, `${pixels} pixels: met nothing`)
    assert.equal(counter.loads, 5, `${pixels} pixels`)
  }
})

test('the first sample behind the depth ends the ray a step and a half back, never before its start', () => {
  // Samples at (dither + 0.5 + k) / 4 of the ray: dither 0 puts them at x = 68.5, 76.5, 84.5, 92.5.
  const wall = caster((x) => (x >= 80 ? 0.6 : 0.1)).cast
  assert.ok(Math.abs(wall(O, D, 1, 0) - (0.625 - 0.375)) < 1e-6)
  // Dither 0.9: x = 75.7, 83.7, ...: the second sample is behind it.
  assert.ok(Math.abs(wall(O, D, 1, 0.9) - (0.6 - 0.375)) < 1e-6)
  // A wall at the first sample: at 0, never negative.
  assert.equal(caster((x) => (x >= 66 ? 0.6 : 0.1)).cast(O, D, 1, 0), 0)
  // The answer is a length: the ray's own scaled.
  assert.ok(
    Math.abs(
      wall(
        O,
        D.map((v) => v / 2),
        2,
        0,
      ) -
        2 * 0.25,
    ) < 1e-6,
  )
})

test("a sample on the start pixel's own depth is the receiver, and no occluder", () => {
  // The whole image at the start's depth, nearer than the ray everywhere: the receiver's plane.
  assert.equal(caster(() => 0.6).cast(O, D, 1, 0), 1)
})

test('a transparent surface is no occluder: the opaque depth alone is sampled', () => {
  const pane = (x: number) => (x >= 70 ? 0.9 : 0)
  assert.equal(caster(() => 0.1, pane).cast(O, D, 1, 0), 1)
})
