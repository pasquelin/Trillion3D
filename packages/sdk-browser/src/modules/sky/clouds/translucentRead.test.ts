// The cloud image the translucent surfaces read per vertex (`translucentRead.ts`): the layer to lay
// over a vertex's fog, from the image's colour and its front depth, run in JavaScript as shipped
// (`shaderRun`); and the block that says how to read the image.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import {
  CLOUD_FOG_BLOCK,
  cloudFogLayoutEntries,
  cloudFogReadWgsl,
  writeCloudFogBlock,
} from './translucentRead.ts'
import type { CloudShown } from './viewTargets.ts'

const BINDINGS = { group: 0, block: 42, colour: 43, depth: 44, sampler: 45 }
const WGSL = cloudFogReadWgsl(BINDINGS)

/** `cloudFogOver` as shipped, over the block `block` and an image of 8 by 4 texels that `reads`
 *  loads and samples. */
function cloudFogRun(
  block: { uv: number[]; soft: number[] },
  reads: {
    textureLoad: (texture: unknown, at: number[]) => number[]
    textureSampleLevel: (texture: unknown, sampler: unknown, uv: number[]) => number[]
  },
) {
  return shaderRun<{
    cloudFogOver: (clip: number[], p: number[], eye: number[]) => number[]
  }>(WGSL, ['cloudFogOver'], {
    cloudFog: block,
    cloudFogColour: {},
    cloudFogDepth: {},
    cloudFogSampler: {},
    textureDimensions: () => [8, 4],
    ...reads,
  }).cloudFogOver
}

/** The layer at a vertex whose clip position is the screen's centre, `km` kilometres from the eye,
 *  the least front depth the four texels around the centre hold
 *  is `fronts`' least, the colour is `colour` there, and the block is `block`. `loads` collects the
 *  texels read. */
function layerAt(
  km: number,
  fronts: number[],
  colour: number[],
  block: { uv: number[]; soft: number[] },
  loads: number[][] = [],
) {
  const cloudFogOver = cloudFogRun(block, {
    textureLoad: (_t: unknown, at: number[]) => {
      loads.push(at)
      return [fronts[loads.length - 1], 0, 0, 0]
    },
    textureSampleLevel: () => colour,
  })
  return cloudFogOver([0, 0, 0.5, 1], [0, 0, km * 1000], [0, 0, 0])
}

const READ = { uv: [1, 1, 0.9, 0.9], soft: [0.5, 0.25, 1, 0] }
const CLEAR = [0, 0, 0, 1]

test('a vertex behind the cloud’s front takes the cloud over its fog, faded in over the soft blending', () => {
  const colour = [4, 8, 12, 0.5]
  // 0.25 km behind the front of 10 km, over 0.5 km: half way. The light is taken back to the light
  // the blended pass multiplies by its own pre-exposure (x 0.25): [1, 2, 3] with a transmittance 0.5.
  const half = layerAt(10.25, [12, 11, 10, 13], colour, READ)
  assert.deepEqual(half, [0.5, 1, 1.5, 0.75])
  // Past the soft blending: the whole cloud.
  assert.deepEqual(layerAt(11, [12, 11, 10, 13], colour, READ), [1, 2, 3, 0.5])
})

test('the front is the least of the four depths a gather would read: a trail a bilinear depth leaves is not cloud', () => {
  const loads: number[][] = []
  // The centre of the screen at uv (0.5, 0.5) of the 8 by 4 image is its texel corner (4, 2): the
  // texels (3, 1), (4, 1), (3, 2), (4, 2).
  layerAt(10.25, [12, 11, 10, 13], [4, 8, 12, 0.5], READ, loads)
  assert.deepEqual(loads, [
    [3, 1],
    [4, 1],
    [3, 2],
    [4, 2],
  ])
  // The least, 10, is the front: a vertex at 9.9 km is before it.
  assert.deepEqual(layerAt(9.9, [12, 11, 10, 13], [4, 8, 12, 0.5], READ), CLEAR)
})

test('a vertex before the front, or no image, takes no cloud', () => {
  const colour = [4, 8, 12, 0.5]
  assert.deepEqual(layerAt(5, [12, 12, 12, 12], colour, READ), CLEAR, 'before the front')
  const none = { uv: READ.uv, soft: [0.5, 0.25, 0, 0] }
  assert.deepEqual(layerAt(20, [12, 12, 12, 12], colour, none), CLEAR, 'no image this image')
})

test('the screen is read at the image’s scale and held to its most', () => {
  const read = (block: { uv: number[]; soft: number[] }) => {
    const sampled: number[][] = []
    const cloudFogOver = cloudFogRun(block, {
      textureLoad: () => [0, 0, 0, 0],
      textureSampleLevel: (_t: unknown, _s: unknown, uv: number[]) => (
        sampled.push(uv),
        [1, 1, 1, 1]
      ),
    })
    // The right edge of the screen (clip x 1), its centre in y.
    cloudFogOver([1, 0, 0.5, 1], [0, 0, 20000], [0, 0, 0])
    return sampled[0]
  }
  assert.deepEqual(read({ uv: [0.5, 0.5, 0.9, 0.9], soft: [0.5, 1, 1, 0] }), [0.5 * 1, 0.25])
  // A texture bigger than the part the view fills: the screen's 1 is 0.75 of it, held to 0.7.
  assert.deepEqual(read({ uv: [0.75, 0.5, 0.7, 0.9], soft: [0.5, 1, 1, 0] }), [0.7, 0.25])
})

test('the block says how the image is read, and that none is bound when there is none', () => {
  const shown = {
    uvScale: [0.5, 0.25],
    uvMax: [0.49, 0.24],
    preExposure: 4,
    softBlendingKm: 0.5,
  } as unknown as CloudShown
  const words = new Float32Array(CLOUD_FOG_BLOCK.words)
  const { at } = CLOUD_FOG_BLOCK
  writeCloudFogBlock(words, shown)
  assert.deepEqual(
    Array.from(words.slice(at.uv, at.uv + 4)),
    [0.5, 0.25, 0.49, 0.24].map(Math.fround),
  )
  assert.deepEqual(Array.from(words.slice(at.soft, at.soft + 4)), [0.5, 0.25, 1, 0])
  writeCloudFogBlock(words, undefined)
  assert.ok(words.every((word) => word === 0))
})

test('the layout holds the block, the two images and the sampler, for the stage it is given', () => {
  const entries = cloudFogLayoutEntries(BINDINGS, 1)
  assert.deepEqual(
    entries.map(({ binding }) => binding),
    [42, 43, 44, 45],
  )
  assert.ok(entries.every(({ visibility }) => visibility === 1))
  assert.equal(entries[2].texture?.sampleType, 'unfilterable-float', 'the depth is read by load')
})
