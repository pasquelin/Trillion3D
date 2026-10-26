// The glow's dirt mask is read in the lens' space: the image's own place for a view drawn whole,
// the tile's place in the wider view for a tile of one, by the finishing and by the bloom's own
// composite alike. And what the glow adds to a pixel: its keep, its dirt, the alpha it keeps.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { BLOOM_COMPOSITE_WGSL } from '../effects/bloom/bloomWgsl.ts'
import { filmRun } from './finishScope.fixture.ts'
import { lensOf, type FinishInput } from './finishParams.ts'
import { GLOWED_PIXEL_WGSL } from './finishWgsl.ts'

/** The left half of a view, as a tile of it: the tile's square is the wider view's from −1 to 0. */
const LEFT_HALF = { scaleX: 2, scaleY: 1, offsetX: -1, offsetY: 0 }

/** Where the finishing reads the dirt mask for the pixel at `uv` under the lens `lens`. */
function finishingReads(lens: readonly number[], uv: number[]) {
  const at: number[][] = []
  const scope = {
    glowImage: 'glow',
    dirtImage: 'dirt',
    finishSampler: 'sampler',
    textureSampleLevel: (image: string, _: string, where: number[]) => {
      if (image === 'dirt') at.push(where)
      return [0.5, 0.5, 0.5, 0.25]
    },
  }
  filmRun<{ finished: (source: number[], uv: number[], gain: number) => number[] }>(
    {},
    ['finished'],
    scope,
    { vignette: 0, local: false, glow: true, dirt: [2, 2, 2], lens },
  ).finished([0.2, 0.4, 0.8, 1], uv, 1)
  return at[0]
}

/** Where the bloom's composite reads the dirt mask for the pixel at (2.5, 1.5) of an image 8 × 4,
 *  under the lens `lens`. */
function compositeReads(lens: readonly number[]) {
  const at: number[][] = []
  const { composite } = shaderRun<{ composite: (pixel: number[]) => number[] }>(
    BLOOM_COMPOSITE_WGSL,
    ['composite'],
    {
      scene: 'scene',
      glow: 'glow',
      reader: 'reader',
      dirtImage: 'dirt',
      look: { keep: [0, 0, 0, 0], dirt: [2, 2, 2, 1], lens },
      textureDimensions: () => [8, 4],
      textureLoad: () => [1, 2, 3, 0.75],
      textureSampleLevel: (image: string, _: string, where: number[]) => {
        if (image === 'dirt') at.push(where)
        return [0.5, 0.25, 1, 1]
      },
    },
  )
  composite([2.5, 1.5, 0, 1])
  return at[0]
}

test('the lens of a camera drawing a tile is the tile’s centre and scale in the wider view, a whole view’s is none', () => {
  assert.deepEqual([...lensOf(null)], [0, 0, 1, 1])
  assert.deepEqual([...lensOf(undefined)], [0, 0, 1, 1])
  assert.deepEqual([...lensOf(LEFT_HALF)], [-0.5, 0, 0.5, 1])
  assert.deepEqual(
    [...lensOf({ scaleX: 4, scaleY: 4, offsetX: 3, offsetY: -1 })],
    [0.75, -0.25, 0.25, 0.25],
  )
})

test('the finishing reads the dirt mask at the pixel’s place in the lens’ space', () => {
  assert.deepEqual(finishingReads(lensOf(null), [0.3, 0.6]), [0.3, 0.6], 'a view drawn whole')
  // The pixel's place in the wider view's square, x from −0.4 to −0.7, y up, then down into the
  // mask's square: the tile's own y, its x halved toward the left edge.
  const seen = finishingReads(lensOf(LEFT_HALF), [0.3, 0.6])
  near(seen[0], 0.5 + 0.5 * (-0.5 + (0.3 * 2 - 1) * 0.5), 'the x of the lens', 1e-9)
  near(seen[1], 0.6, 'the y the tile leaves where it is', 1e-9)
  // A lens off the middle in y moves the read down the mask by its offset, as the lens' y is up.
  near(finishingReads([0, 0.5, 1, 1], [0.3, 0.6])[1], 0.6 - 0.25, 'an offset in y', 1e-9)
})

test('the bloom’s composite reads the same place as the finishing: the lens’ space', () => {
  assert.deepEqual(compositeReads(lensOf(null)), [0.3125, 0.375], 'a view drawn whole')
  const seen = compositeReads(lensOf(LEFT_HALF))
  const uv = [2.5 / 8, 1.5 / 4]
  assert.deepEqual(seen, finishingReads(lensOf(LEFT_HALF), uv))
  near(seen[0], 0.5 + 0.5 * (-0.5 + (uv[0] * 2 - 1) * 0.5), 'the x of the lens', 1e-9)
})

test('the glow comes with the dirt its mask shows and the light it left the image, each a word the shader tests once', () => {
  const reads: unknown[] = []
  const textureSampleLevel = (image: unknown) => (
    reads.push(image),
    image === 'dirt' ? [0.5, 0.25, 1, 1] : [0.5, 0.5, 0.5, 0.25]
  )
  const scope = {
    glowImage: 'glow',
    dirtImage: 'dirt',
    finishSampler: 'sampler',
    textureSampleLevel,
  }
  const run = (input: Partial<FinishInput>) =>
    filmRun<{ finished: (source: number[], uv: number[], gain: number) => number[] }>(
      {},
      ['finished'],
      scope,
      {
        ...{ vignette: 0, local: false, glow: true },
        ...input,
      },
    ).finished([0.2, 0.4, 0.8, 1], [0.3, 0.6], 1)
  const near3 = (got: number[], want: number[]) =>
    want.forEach((value, c) => near(got[c], value, `channel ${c}`, 1e-6))
  near3(run({}), [0.7, 0.9, 1.3]) // the light and the glow, added
  assert.deepEqual(reads, ['glow'], 'no mask: no read of it')
  near3(run({ keep: [0.5, 0.25, 1] }), [0.6, 0.6, 1.3]) // the light the glow took, gone
  reads.length = 0
  near3(run({ dirt: [2, 2, 2] }), [1.2, 1.15, 2.3]) // glow × (1 + mask × dirt)
  assert.deepEqual(reads, ['glow', 'dirt'])
})

test('one function adds a glow to a pixel, for the finishing and for the bloom’s own composite: its keep, its dirt, the alpha kept', () => {
  type Glowed = { glowedPixel: (...args: number[][]) => number[] }
  const { glowedPixel } = shaderRun<Glowed>(GLOWED_PIXEL_WGSL, ['glowedPixel'], {})
  const [none, glow, mask] = [
    [0, 0, 0, 0],
    [0.5, 0.5, 0.5, 0.25],
    [0.5, 0.25, 1],
  ]
  const is = (got: number[], want: number[], label: string) => near(got, want, label, 1e-6)
  const added = (base: number[], keep = none, dirt = none) =>
    glowedPixel(base, keep, glow, mask, dirt)
  is(added([0.2, 0.4, 0.8, 0.5]), [0.7, 0.9, 1.3, 0.5], 'the light and the glow, added')
  is(added([0.2, 0.4, 0.8, 1]), [0.7, 0.9, 1.3, 1], 'the alpha kept')
  is(added([0.2, 0.4, 0.8, 0.5], [0.5, 0.25, 1, 1]), [0.6, 0.6, 1.3, 0.5], 'what the glow left')
  is(added([0.2, 0.4, 0.8, 0.5], none, [2, 2, 2, 1]), [1.2, 1.15, 2.3, 0.5], 'the dirt')
})
