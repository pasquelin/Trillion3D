// The sun's distance-field shadow: the meshes the cascade takes, its culling hull, and the upsample of its
// half-resolution result into the mask's lanes, run on the shipped text.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { OBJECT_FLAGS as F } from '../layout.ts'
import { DFSH_CULL_WGSL } from './cullWgsl.ts'
import { DFSH_FINAL_WGSL } from './finalWgsl.ts'
import { DFSH_FLAG } from './layout.ts'

/** Whether a sun's cascade takes a mesh of `flags`, the view's `farShadowCullsAllMeshes` being `all`. */
function takes(flags: number, all: boolean) {
  const { dfshCasts } = shaderRun<{ dfshCasts: (flags: number) => boolean }>(
    DFSH_CULL_WGSL,
    ['dfshCasts'],
    { dfsh: { counts: [0, 0, 0, all ? DFSH_FLAG.farMeshes : 0] } },
  )
  return dfshCasts(flags)
}

test('a mesh is shadowed by the cascade where the shadow maps leave it out far away, not where they draw it at any distance', () => {
  const base = F.castShadow | F.visible | F.virtualized
  // Drawn into the maps at any distance (nothing says the far-shadow test reaches it): not here.
  assert.equal(takes(base | F.farTestable, false), false)
  // The test reaches it, by what its object says, or by the view's rule for every mesh.
  assert.equal(takes(base | F.farTestable | F.farTested, false), true)
  assert.equal(takes(base | F.farTestable, true), true)
  // It never does (`farTestable` is left out of its flags): the maps keep it, whatever the view says.
  assert.equal(takes(base, true), false)
  // A mesh that casts far shadows is in the maps at any distance; one that casts none, or is hidden, casts none here.
  assert.equal(takes(base | F.farTestable | F.farTested | F.castsFar, true), false)
  assert.equal(takes(F.visible | F.farTestable | F.farTested, true), false)
  assert.equal(takes(F.castShadow | F.farTestable | F.farTested, true), false)
})

test('the cascade’s hull keeps a mesh whose sphere is not wholly outside a plane', () => {
  // Two planes of a hull: x at most 100 (outward +x), z at least 0 (outward -z).
  const planes = [
    [1, 0, 0, 100],
    [0, 0, -1, 0],
  ]
  const { dfshHullTouches } = shaderRun<{
    dfshHullTouches: (centre: number[], radius: number) => boolean
  }>(DFSH_CULL_WGSL, ['dfshHullTouches'], { dfsh: { counts: [2, 0, 0, 0], planes } })
  assert.equal(dfshHullTouches([0, 0, 50], 10), true, 'inside')
  assert.equal(dfshHullTouches([150, 0, 50], 60), true, 'its sphere reaches the plane')
  assert.equal(dfshHullTouches([150, 0, 50], 40), false, 'wholly outside the first plane')
  assert.equal(dfshHullTouches([0, 0, -30], 20), false, 'wholly outside the second plane')
})

const NEAR = { range: [0, 1000, 1e9, 0], fade: [-1, 1, 1, 0], lane: [1, 0, 0, 0] }

/** The upsample of a pixel by a result whose texels `texel(x, y)` says, in a view of 8 × 8 pixels
 *  traced every `down` pixels. */
function upsampled(
  pixel: number[],
  depth: number,
  texel: (x: number, y: number) => number[],
  down = 2,
  light = NEAR,
) {
  const { dfshUpsampled } = shaderRun<{
    dfshUpsampled: (pixel: number[], depth: number, light: object) => number
  }>(DFSH_FINAL_WGSL, ['dfshUpsampled'], {
    dfshFinal: { view: [8, 8, down, 1] },
    halfFactors: { load: ([x, y]: number[]) => texel(x, y) },
  })
  return dfshUpsampled(pixel, depth, light)
}

test('the upsample weighs the four texels round a pixel by their share, their depth and whether the cascade reached them', () => {
  const at100 = (visibility: number) => [visibility, 100]
  // The texel's own pixel (the rays started there): its value.
  assert.equal(
    upsampled([2, 2], 100, () => at100(0.5)),
    0.5,
  )
  // Between a shadowed texel and a lit one, level in depth: half.
  const side = (x: number) => at100(x === 0 ? 0 : 1)
  assert.equal(upsampled([1, 0], 100, side), 0.5)
  // The lit one a far surface's: the depth weight leaves the near surface's shadow.
  const farLit = (x: number) => (x === 0 ? at100(0) : [1, 5000])
  assert.ok(upsampled([1, 0], 100, farLit) < 0.001)
  // The lit one outside the cascade's depths and unshadowed: not counted at all.
  const outside = (x: number) => (x === 0 ? at100(0.2) : [1, 5000])
  assert.ok(Math.abs(upsampled([1, 0], 100, outside) - 0.2) < 1e-6)
  // Nothing counted: lit.
  assert.equal(
    upsampled([1, 0], 100, () => [1, 5000]),
    1,
  )
  // At the display's resolution: the texel itself.
  assert.equal(
    upsampled([3, 5], 100, (x, y) => at100(x === 3 && y === 5 ? 0.25 : 0.9), 1),
    0.25,
  )
  // Past the last texel the neighbours are the last one.
  assert.equal(
    upsampled([7, 7], 100, (x, y) => at100(x === 3 && y === 3 ? 0.1 : 0.7)),
    0.1,
  )
})

test('the cascade fades out toward its far end and in from its near end, and the mask holds the lanes’ roots', () => {
  const { dfshFade } = shaderRun<{ dfshFade: (v: number, depth: number, light: object) => number }>(
    DFSH_FINAL_WGSL,
    ['dfshFade'],
    {},
  )
  const light = { range: [0, 1000, 900, 0.01], fade: [-100, 0.01, 1, 0], lane: [1, 0, 0, 0] }
  assert.equal(dfshFade(0, 500, light), 0, 'in the cascade')
  assert.ok(Math.abs(dfshFade(0, 950, light) - 0.5) < 1e-6, 'half way out')
  assert.equal(dfshFade(0, 1000, light), 1, 'gone at the far end')
  const entering = { ...light, range: [0, 1000, 5000, 0], fade: [400, 0.01, 1, 0] }
  assert.equal(dfshFade(0, 400, entering), 1, 'not yet in')
  assert.ok(Math.abs(dfshFade(0, 450, entering) - 0.5) < 1e-6, 'half way in')
  assert.equal(dfshFade(0, 500, entering), 0, 'in')
  assert.ok(Math.abs(dfshFade(0, 500, { ...entering, fade: [400, 0.01, 0.25, 0] }) - 0.75) < 1e-6)
})

test('a lane holds the square root of the visibility in a byte, a lane without a cascade one, after the word of the stride', () => {
  const mask = new Array(1 + 8 * 8).fill(7)
  const { dfshFinalPass } = shaderRun<{ dfshFinalPass: (id: number[]) => void }>(
    DFSH_FINAL_WGSL,
    ['dfshFinalPass'],
    {
      dfshFinal: {
        view: [8, 8, 1, 1],
        extent: [8, 8, 0, 0],
        depth: [1, 0, 1, 0],
        lights: [NEAR, ...[0, 0, 0].map(() => ({ ...NEAR, lane: [0, 0, 0, 0] }))],
      },
      hizOpaqueDepth: () => 0.01,
      halfFactors: { load: () => [0.25, 100] },
      maskOut: mask,
    },
  )
  dfshFinalPass([0, 0, 0])
  dfshFinalPass([3, 2, 0])
  assert.equal(mask[0], 8, 'the word of the row’s width')
  assert.equal(
    mask[1 + 2 * 8 + 3] >>> 0,
    0xffffff80,
    'the first lane: sqrt(0.25) = 128 / 255, the others lit',
  )
  assert.equal(mask[1], 0xffffff80)
  assert.equal(mask[1 + 1], 7, 'a pixel not run is left')
})
