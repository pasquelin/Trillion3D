// The ambient occlusion's tables, passes and uniform, as the lighting composes them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { AO_QUALITY_SHAPES, AO_RANDOM_BASIS, AO_SAMPLE_SETS } from '../ao/tables.ts'
import { referenceNoiseBytes } from '../ao/reference.fixture.ts'
import { aoExtentOf, aoPasses, aoTargetExtent, aoTargetRect } from '../ao/plan.ts'
import { discMethod } from '../ao/discFrame.ts'
import { aoViewBytes } from '../ao/view.ts'
import { AO_PARAMS_BYTES } from '../ao/layout.ts'
import { HEIGHT, settingsOf, uniformOf, WIDTH } from '../ao/scene.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'

test('the occlusion’s qualities, sample sets and noise directions are the reference’s', () => {
  assert.deepEqual(
    AO_QUALITY_SHAPES.map(({ sampleSet, steps, quadBlur }) => [sampleSet, steps, quadBlur]),
    [
      [1, 1, false],
      [1, 1, true],
      [1, 2, true],
      [1, 3, false],
      [3, 3, false],
    ],
  )
  assert.deepEqual(AO_SAMPLE_SETS[3][5], [0.06, 0.9])
  assert.deepEqual(
    AO_SAMPLE_SETS[1].map((p) => p.map((x) => +x.toFixed(4))),
    [
      [0, -0.43],
      [0.406, 0.5698],
      [-0.58, 0.814],
    ],
  )
  // The sixteen byte pairs of the 4 × 4 block, written out, are what a single-precision derivation of them gives: the basis they read as.
  assert.deepEqual(
    AO_RANDOM_BASIS,
    referenceNoiseBytes().map(([cos, sin]) => [(cos / 255) * 2 - 1, (sin / 255) * 2 - 1]),
  )
  assert.deepEqual(
    AO_RANDOM_BASIS.slice(0, 2).map((p) => p.map((x) => +x.toFixed(6))),
    [
      [0.882353, 0.003922],
      [-0.47451, 0.717647],
    ],
  )
})

test('the occlusion draws as many resolutions as its quality asks, each a half of the one before', () => {
  const targets = (levels: number) => aoPasses(levels).map((p) => `${p.kind}:${p.target}`)
  // One resolution is the last pass alone: the taps read the depth pyramid's cells, no half-size map is made first.
  assert.deepEqual(targets(1), ['final:ao'])
  assert.deepEqual(targets(2), ['setup:setup1', 'step:ao1', 'final:ao'])
  assert.deepEqual(targets(3), ['setup:setup1', 'setup:setup2', 'step:ao2', 'step:ao1', 'final:ao'])
  const last = aoPasses(3).at(-1)!
  assert.deepEqual([last.setup, last.lower], ['setup1', 'ao1'])
  assert.equal(aoPasses(3)[3].lower, 'ao2')
  // A texture is made at a multiple of eight, and its half and quarter are whole pixels.
  assert.deepEqual(aoExtentOf([1366, 768]), [1368, 768])
  assert.deepEqual(aoTargetExtent('setup2', [1368, 768]), [342, 192])
  assert.deepEqual(aoTargetRect('ao1', [1367, 767]), [684, 384])
  // The setups hold eight bytes a pixel, the occlusions one, and each pass a uniform; one resolution holds the occlusion alone.
  installGpuGlobals()
  const bytes = (levels: number) =>
    aoViewBytes(discMethod(settingsOf({ ambientOcclusionLevels: levels })).spec([64, 32], false))
  assert.equal(bytes(2), 32 * 16 * 8 + 32 * 16 + 64 * 32 + 3 * AO_PARAMS_BYTES)
  assert.equal(bytes(1), 64 * 32 + AO_PARAMS_BYTES)
})

test('the occlusion’s uniform holds the reference’s numbers, the radius grown for each halving', () => {
  const words = (levels: number, pass: number) => uniformOf(levels, pass)
  const full = words(2, 2)
  // Radius 200 over the 400 units of the view, shared out by four; power 2, bias 3 a thousand, intensity 0.5, blend 0.6.
  assert.deepEqual(
    full.shape.map((x) => +x.toFixed(6)),
    [2, 0.003, 0.5, 0.6],
  )
  assert.deepEqual(
    full.reach.map((x) => +x.toFixed(6)),
    [0.125, 0, 1, 0.4],
  )
  // The half pass takes the scale once: 1.7 times the radius; its depth threshold is halved.
  const half = words(2, 1)
  assert.deepEqual(
    half.reach.map((x) => +x.toFixed(6)),
    [0.2125, 0, 2, 0.4],
  )
  assert.equal(+half.fade[2].toFixed(6), 0.005)
  assert.equal(+words(3, 2).reach[0].toFixed(6), +((0.5 * 1.7 ** 2) / 4).toFixed(6))
  // The fade: a multiplier over the fade radius and an addend that ends it at the fade distance, in centimetres.
  assert.deepEqual(
    full.fade.slice(0, 2).map((x) => +x.toFixed(6)),
    [0.0002, -0.6],
  )
  // The drawn rectangle, the texture, the coarser texture and the setup it reads.
  assert.deepEqual(half.rects, [WIDTH / 2, HEIGHT / 2, WIDTH / 2, HEIGHT / 2])
  assert.deepEqual(full.low, [WIDTH / 2, HEIGHT / 2, WIDTH / 2, HEIGHT / 2])
  assert.deepEqual(full.upper.slice(0, 2), [WIDTH / 2, HEIGHT / 2])
  // The camera looks down -z: its forward is -z. The projection's depth terms are the temporal passes' (`writeDepthTerms`): a
  // perspective's depth is near over distance, and a pixel's radius a share of the distance.
  assert.deepEqual(
    [full.right, full.up, full.forward].map((v) => v.slice(0, 3)),
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, -1],
    ],
  )
  assert.deepEqual(
    full.depth.map((x) => +x.toFixed(6)),
    [0, 0.1, -1, 0],
  )
  assert.deepEqual(
    full.radius.map((x) => +x.toFixed(6)),
    [0.016038, 0, -1, 0],
  )
  // In the world's units the radius is the settings' own, in centimetres, shared out by four.
  assert.equal(
    +uniformOf(1, 0, settingsOf({ ambientOcclusionRadiusInWorldSpace: true })).reach[0].toFixed(6),
    50,
  )
})
