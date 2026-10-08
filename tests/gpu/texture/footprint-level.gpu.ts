// Every texture reads its footprint's level on the GPU (`texture/samplingFootprint.ts`), the WebGPU
// rule: a filter without `mip` — on a texture created in the page as on the cache's — reads the
// level log2 of its footprint, never level 0 whatever the footprint; magnification is a level at
// or under 0 for every filter, a `nearest` mip rounds the level, and a linear read mixed across
// levels takes its anisotropic taps. Run on Dawn through the pools' own header and level of detail.
//
//   node bench/dawn/proofs.ts tests/gpu/texture/footprint-level.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import type { Texture, TextureFilter } from '../../../packages/sdk-core/src/index.ts'
import {
  SAMPLE_FILTER_MASK,
  samplingWords,
} from '../../../packages/sdk-browser/src/texture/sampling.ts'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import type { FootprintCase } from './footprintLevelPage.ts'
import { clamp } from '../../../packages/math/src/scalar/reals.ts'

const SIZE = 256,
  LAST = 8

/** The filters, as a texture names them: minification, magnification, anisotropy. */
const FILTERS: Array<[TextureFilter, TextureFilter, number]> = [
  ['linear', 'linear', 1],
  ['nearest', 'nearest', 1],
  ['nearest-mip-nearest', 'linear', 1],
  ['linear-mip-nearest', 'nearest', 1],
  ['linear-mip-linear', 'linear', 1],
  ['linear', 'linear', 16],
]

/** Texels a pixel spans, along x then y: magnified, at the switch, past it by 0.4 level, minified
 *  by whole and broken levels, beyond the chain, and stretched sixteen to one. */
const FOOTPRINTS: Array<[number, number]> = [
  [0.25, 0.25],
  [1, 1],
  [2 ** 0.4, 2 ** 0.4],
  [3, 3],
  [16, 16],
  [1024, 1024],
  [16, 1],
]

test('every texture reads the level of its footprint, a filter without mip included', async () => {
  const cases: Array<FootprintCase & { name: string; want: number[] }> = []
  for (const [minFilter, magFilter, anisotropy] of FILTERS) {
    const record = {
      wrapS: 'clamp',
      wrapT: 'clamp',
      minFilter,
      magFilter,
      anisotropy,
      transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    } as unknown as Texture
    const sampling = samplingWords(record)[0] & SAMPLE_FILTER_MASK
    for (const [x, y] of FOOTPRINTS) {
      // WebGPU's rule: taps the elongation within the grant, the level log2 of the longer side
      // shared among them, clamped to the chain, rounded by a `nearest` mip.
      const taps = Math.min(Math.ceil(Math.max(x, y) / Math.min(x, y) - 0.01), anisotropy)
      const raw = Math.log2(Math.max(x, y)) - Math.log2(taps)
      let lod = clamp(raw, 0, LAST)
      if (minFilter.endsWith('mip-nearest')) lod = Math.floor(lod + 0.5)
      const nearest = (raw <= 0 ? magFilter : minFilter).startsWith('nearest') ? 1 : 0
      cases.push({
        name: `${minFilter}/${magFilter} ×${anisotropy} at ${x}×${y}`,
        want: [lod, taps, nearest],
        sampling,
        last: LAST,
        size: [SIZE, SIZE],
        ddx: [x / SIZE, 0],
        ddy: [0, y / SIZE],
      })
    }
  }
  const page = (await loadPage(
    resolve(import.meta.dirname, 'footprintLevelPage.ts'),
    'footprintLevelPage',
  )) as typeof import('./footprintLevelPage.ts')
  const { adapter, reads, errors } = await runOnDawn((all) => page.run(all), cases)
  assert.deepEqual(errors, [])
  cases.forEach(({ name, want: [lod, taps, nearest] }, n) => {
    const [readLod, readTaps, readNearest] = reads[n]
    assert.ok(Math.abs(readLod - lod) <= 1e-3, `${name}: level ${readLod}, not ${lod}`)
    assert.equal(readTaps, taps, `${name}: taps`)
    assert.equal(readNearest, nearest, `${name}: texel pick`)
  })
  console.log(JSON.stringify({ adapter, cases: cases.length }))
})
