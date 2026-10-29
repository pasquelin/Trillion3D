// The set's options as its layout holds them: the receiver cover of the suns' maps or of every map,
// the kept pages, the second layer of the pyramid and the prefiltered distant shadow, read back from
// the layout (`askedOfLayout`) as the engine asks them (`engineVsmOptions`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { dynamicHzbOf, vsmCoverHolds, vsmLayout, type VsmLayout } from './layout.ts'
import { noDofBias } from './dofBias.ts'
import { writeVsmUniforms, type VsmFrameUniforms } from './uniforms.ts'
import { askedOfLayout, engineVsmOptions } from './frame/vsmLightMaps.ts'
import { VSM_POOL_PAGES, VSM_UNIFORMS_BYTES } from './constants.ts'

test('the receiver cover holds the suns’ maps, or every map’s with coverMode all', () => {
  const suns = vsmLayout({ coverMode: 'suns', fullMapCapacity: 127, sunMapCapacity: 18 })
  const every = vsmLayout({ coverMode: 'all', fullMapCapacity: 127, sunMapCapacity: 18 })
  assert.deepEqual([suns.coverMode, every.coverMode], ['suns', 'all'])
  assert.ok(every.coverWords > suns.coverWords)
  assert.deepEqual(
    every.coverSize,
    vsmLayout({ coverMode: 'suns', fullMapCapacity: 127 }).coverSize,
    'a block a map',
  )
})

test('a held cover holds what a lesser one asks: none, the suns’ maps, every map’s', () => {
  assert.deepEqual(
    [
      vsmCoverHolds('all', 'suns'),
      vsmCoverHolds('suns', 'suns'),
      vsmCoverHolds('suns', 'all'),
      vsmCoverHolds('none', 'suns'),
      vsmCoverHolds('suns', 'none'),
    ],
    [true, true, false, false, true],
  )
})

test('the engine’s set options carry the kept pages and the cover into its layout', () => {
  const layout = (cacheEnabled: boolean, coverMode: 'suns' | 'all') =>
    vsmLayout(
      engineVsmOptions(63, 17, {
        poolPages: VSM_POOL_PAGES,
        occlusion: true,
        dynamicHzb: true,
        cacheEnabled,
        coverMode,
        prefilteredDistant: false,
        classic: false,
      }),
    )
  const [kept, uncached, covered] = [
    layout(true, 'suns'),
    layout(false, 'suns'),
    layout(true, 'all'),
  ]
  // The static slice word of the uniform block (word 6): 1 with the cache, else 0.
  const sliceWord = (layout: VsmLayout) => {
    const image = new ArrayBuffer(VSM_UNIFORMS_BYTES)
    writeVsmUniforms(image, layout, { dof: noDofBias() } as VsmFrameUniforms)
    return new Uint32Array(image)[6]
  }
  assert.deepEqual(
    [kept.cacheEnabled, sliceWord(kept), kept.hzbLayers, kept.coverMode],
    [true, 1, 2, 'suns'],
  )
  assert.deepEqual(
    [uncached.cacheEnabled, sliceWord(uncached), uncached.hzbLayers],
    [false, 0, 1],
    'no static slice, one layer',
  )
  assert.deepEqual([covered.cacheEnabled, sliceWord(covered), covered.coverMode], [true, 1, 'all'])
  // What a set holds of the options reads back from its layout, the second layer as asked where on.
  assert.deepEqual(askedOfLayout(covered), {
    poolPages: covered.poolPages,
    occlusion: true,
    dynamicHzb: true,
    cacheEnabled: true,
    coverMode: 'all',
    prefilteredDistant: false,
    classic: false,
    overdraw: false,
  })
  assert.equal(askedOfLayout(uncached).dynamicHzb, false, 'no second layer without the cache')
  // The second layer asked without the pyramid is no layer: the one rule the held set is weighed by.
  const blind = vsmLayout({
    coverMode: 'suns',
    fullMapCapacity: 63,
    occlusion: false,
    dynamicHzb: true,
  })
  assert.equal(blind.hzbLayers, 1)
  assert.equal(dynamicHzbOf(false, true, true), false)
})

test('the prefiltered distant shadow is asked of the set and read back from its layout', () => {
  const asked = (prefilteredDistant: boolean) =>
    engineVsmOptions(63, 17, {
      ...{ poolPages: VSM_POOL_PAGES, occlusion: true, dynamicHzb: false },
      ...{ cacheEnabled: true, coverMode: 'suns', prefilteredDistant, classic: false },
    })
  assert.equal(vsmLayout(asked(false)).prefilteredDistant, false)
  const on = vsmLayout(asked(true))
  assert.equal(on.prefilteredDistant, true)
  assert.equal(askedOfLayout(on).prefilteredDistant, true, 'a held set tells what it was made for')
  // A layout of options that say nothing of it holds none.
  assert.equal(vsmLayout({ coverMode: 'suns', fullMapCapacity: 63 }).prefilteredDistant, false)
})

test('the cover masks are made where a receiver mask is on, a 1x1 stand-in else, and a held set tells which', () => {
  const asked = (coverMode: 'suns' | 'none') =>
    engineVsmOptions(63, 17, {
      ...{ poolPages: VSM_POOL_PAGES, occlusion: true, dynamicHzb: false, cacheEnabled: true },
      ...{ coverMode, prefilteredDistant: false, classic: false },
    })
  const made = vsmLayout(asked('suns'))
  const none = vsmLayout(asked('none'))
  assert.deepEqual([made.coverMode, askedOfLayout(made).coverMode], ['suns', 'suns'])
  assert.deepEqual([none.coverMode, askedOfLayout(none).coverMode], ['none', 'none'])
  assert.deepEqual(none.coverSize, [1, 1])
  assert.ok(made.coverWords > none.coverWords)
})
