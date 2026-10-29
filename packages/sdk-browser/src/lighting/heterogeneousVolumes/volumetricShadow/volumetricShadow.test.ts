// The volumetric shadow map: the words of its lists, the layout of its buffers and its kernels' texts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { AVSM_LIST_EDIT_WGSL } from './avsmListEditWgsl.ts'
import { AVSM_WGSL } from './avsmWgsl.ts'
import { AVSM_COMBINE_WGSL } from './combineVolumetricShadowMapsWgsl.ts'
import { AVSM_COMPRESS_WGSL } from './compressVolumetricShadowMapWgsl.ts'
import { avsmConvertToBeerProgram } from './convertAvsmToBeerWgsl.ts'
import { AVSM_CONVERT_BEER_WGSL, AVSM_PARAMS_BYTES } from './convertBeerToAvsmWgsl.ts'
import {
  atlasWordsPerTexel,
  packAvsmParams,
  paddedTexels,
  volumetricShadowBytes,
} from './volumetricShadowEncode.ts'

const entries = (text: string) =>
  [...text.matchAll(/@compute @workgroup_size\([^)]*\)\s*fn (\w+)/g)].map((m) => m[1])
const bindings = (text: string) => [...text.matchAll(/@binding\((\d+)\)/g)].map((m) => Number(m[1]))

test('the parameters are laid out as the kernels read them', () => {
  const bytes = packAvsmParams({
    resolution: [512, 256],
    maxSampleCount: 8,
    compress: true,
    absoluteError: 0.25,
    relativeError: 0.05,
  })
  assert.equal(bytes.byteLength, AVSM_PARAMS_BYTES)
  assert.deepEqual(Array.from(new Int32Array(bytes).slice(0, 4)), [512, 256, 8, 1])
  const f = new Float32Array(bytes)
  assert.equal(f[4], 0.25)
  assert.ok(Math.abs(f[5] - 0.05) < 1e-7)
})

test('a texel takes the top level and the bottom level of its samples, each padded to four', () => {
  assert.equal(atlasWordsPerTexel(2), 8)
  assert.equal(atlasWordsPerTexel(8), 12)
  assert.equal(atlasWordsPerTexel(64), 16 + 64)
})

test('the buffers hold the groups of 8 x 8 whole, the lists only the map', () => {
  assert.equal(paddedTexels([512, 512]), 512 * 512)
  assert.equal(paddedTexels([10, 3]), 16 * 8)
  const bytes = volumetricShadowBytes([10, 3], 6, 8)
  assert.equal(bytes.indirection, 16 * 8 * 6 * 16)
  assert.equal(bytes.atlas, 16 * 8 * 6 * 12 * 4)
  assert.equal(bytes.list, 10 * 3 * 6 * 8 * 8)
})

test('each kernel text declares its entry point over the bindings its layout lists', () => {
  const cases: [string, string, number[]][] = [
    [AVSM_CONVERT_BEER_WGSL, 'convertBeerLawShadowMapToVolumetricShadowMap', [0, 1, 2, 3, 4]],
    [
      avsmConvertToBeerProgram('rgba16float'),
      'convertVolumetricShadowMapToBeerLawShadowMap',
      [0, 1, 2],
    ],
    [AVSM_COMPRESS_WGSL, 'compressVolumetricShadowMap', [0, 1, 2, 3, 4]],
    [AVSM_COMBINE_WGSL, 'combineVolumetricShadowMaps', [0, 1, 2, 3]],
  ]
  for (const [text, name, ids] of cases) {
    assert.deepEqual(entries(text), [name])
    assert.deepEqual(bindings(text), ids, name)
    assert.equal(text.includes('`'), false, name)
  }
  assert.match(avsmConvertToBeerProgram('rgba32float'), /texture_storage_2d<rgba32float,write>/)
})

test('the words of the lists: a distance, a half-float transmittance, two eight-bit links', () => {
  const text = AVSM_WGSL.text
  assert.match(text, /const AVSM_NULL_PTR=0xFFu/)
  assert.match(
    text,
    /fn avsmListPrev\(entry:vec2u\)->u32\{return \(entry\.y>>8u\)&AVSM_NULL_PTR;\}/,
  )
  assert.match(text, /fn avsmListNext\(entry:vec2u\)->u32\{return entry\.y&AVSM_NULL_PTR;\}/)
  assert.match(
    text,
    /\(\(ind\.pixelOffset&AVSM_INVALID_PIXEL_OFFSET\)<<6u\)\|\(u32\(ind\.sampleCount\)&0x3Fu\)/,
  )
  // A texel whose range is none (no volume along its ray) packs a distance of 0 instead of dividing by zero.
  assert.match(text, /if\(extent==0\.0\)\{return 0u;\}/)
})

test('the list edit replaces the entry of least error and the compression is a run-time flag', () => {
  const text = AVSM_LIST_EDIT_WGSL.text
  assert.match(text, /fn avsmLowestErrorIndex\(pixel:i32,maxCount:i32\)/)
  assert.match(text, /for\(var index=1;index<maxCount-1;index\+\+\)/)
  assert.match(text, /fn avsmAddOrReplaceSample\(.*compress:bool/)
  assert.equal(wgslModule(AVSM_LIST_EDIT_WGSL).includes('`'), false)
})

test('the compression and the conversion allocate once a block, behind barriers that every thread of the block reaches', () => {
  for (const text of [AVSM_COMPRESS_WGSL, AVSM_CONVERT_BEER_WGSL]) {
    const barriers = text.match(/workgroupBarrier\(\)/g) ?? []
    assert.ok(barriers.length >= 2)
    assert.match(text, /atomicAdd\(&allocator\[0\]/)
  }
  // No return before the last barrier: a thread outside the map still reaches them.
  const compress = AVSM_COMPRESS_WGSL
  assert.ok(compress.lastIndexOf('workgroupBarrier()') < compress.indexOf('let topOffset'))
  assert.ok(!/return;/.test(compress.slice(0, compress.lastIndexOf('workgroupBarrier()'))))
})
