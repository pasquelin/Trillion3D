// The lit passes of a view whose pixels hold several closures (`ContractKey.closures`) light every closure the record holds and sum them
// by coverage; a view of one closure keeps every pass's text, the key's cut left out. The loop bound and the slice layers are read off the
// two targets' sizes, which the record lays out (`SURFACE_CLOSURES`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { litPassShaders } from '../../gpu/core/shaderTexts.fixture.ts'
import { SURFACE_CLOSURES } from '../../materials/surface/surfaceOutputs.ts'
import { FULL_CONTRACT, SERVING, cutsIn, isTwin, keyOf, twinOf } from './contractCuts.ts'
import { closureTail, litCutOf } from './litSurfaceWgsl.ts'
import { gpuHarness } from './contractLighting.fixture.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import { indirectLayoutEntries } from './layoutEntries.ts'
import { SCREEN_CLOSURES_GATHERED } from '../bounce/screen/screenProbeLayout.ts'
import { reservedNames, unbalanced, unresolvedNames } from '../../gpu/core/wgslNames.fixture.ts'
import { TILE_CLASS } from './tileClass.ts'

const PASSES = ['sun', 'local', 'indirect'] as const

test('a key without the closures cut lights the one closure: no loop, no reader of the slices', () => {
  for (const bounce of [false, true]) {
    const one = litPassShaders(bounce, { lobeless: true, closures: false })
    for (const pass of PASSES) {
      assert.doesNotMatch(one[pass], /closuresHeld|closureLight|closureCoverageAt/)
      assert.match(one[pass], /return lightOut\(/)
    }
    assert.deepEqual(one, litPassShaders(bounce, { lobeless: true }))
  }
})

test('with the cut, each pass loops the closures the pixel holds and sums them by coverage', () => {
  for (const bounce of [false, true]) {
    const several = litPassShaders(bounce, { lobeless: true, closures: true })
    for (const pass of PASSES) {
      const text = several[pass]
      assert.match(
        text,
        /let closureCount=closureCountAt\(coord\);\n for\(var closure=0u;closure<closureCount;closure\+\+\)/,
      )
      assert.match(text, /closureLight\+=coverage\*lightOut\(/)
      assert.match(text, /return closureLight;/)
      assert.doesNotMatch(text, /return lightOut\(/)
      // The closure past the first is read from its slice: base colour and metalness, then normal and roughness.
      assert.match(text, /var base=textureLoad\(colours,coord,slice,0\);/)
      assert.match(text, /let normal=textureLoad\(colours,coord,slice\+1u,0\);/)
    }
  }
})

test('the record’s layout is read off the sizes of the words and colours: one pixel closure count, the first slice’s layer, the coverage word', () => {
  const text = litPassShaders(false, { lobeless: true, closures: true }).sun
  // The words hold the flags, a coverage a closure, five layers (flags and lobes) each closure past the first and the offsets: the closures are read back off the layer count.
  assert.match(
    text,
    new RegExp(
      `fn closuresHeld\\(\\)->u32\\{return closuresHeldOf\\(textureNumLayers\\(words\\)\\);\\}`,
    ),
  )
  assert.match(
    text,
    new RegExp(
      `textureNumLayers\\(colours\\)-${SURFACE_CLOSURES.colours}u\\*\\(closuresHeld\\(\\)-closure\\)`,
    ),
  )
  // A coverage word never written is the first closure of a material of one closure: all of it.
  assert.match(text, /if\(closure==0u&&word==0u\)\{return 1\.0;\}/)
})

test('the cut is a bit of the key, kept by the twin and served by the very same cut alone', () => {
  const set = cutsIn({ ...FULL_CONTRACT, closures: true })
  assert.notEqual(set, cutsIn(FULL_CONTRACT))
  assert.equal(keyOf(false, set).closures, true)
  assert.equal(isTwin({ ...FULL_CONTRACT, closures: true }), true)
  assert.equal(twinOf(set) & set, twinOf(set))
  assert.notEqual(twinOf(set), twinOf(cutsIn(FULL_CONTRACT)))
  for (const own of SERVING[set]) assert.equal(keyOf(false, own).closures, true)
  for (const own of SERVING[cutsIn(FULL_CONTRACT)]) assert.equal(keyOf(false, own).closures, false)
})

test('the toon data keeps the ramp once on the pixel and the closure loop beside it, each closure adding its toon light by its coverage', () => {
  const toon = litCutOf(TILE_CLASS.single, { channelless: false, closures: true, toonData: true })
  assert.equal(toon.closures, true)
  assert.equal(toon.toonData, true)
  const loop = closureTail(toon, 'lightOut(x)', (light) => light)
  assert.equal((loop.match(/toonBefore=vec4f\(toonDiffuse,toonWeight\)/g) ?? []).length, 2)
  assert.equal(
    (loop.match(/toonDiffuse=toonBefore\.xyz\+coverage\*\(toonDiffuse-toonBefore\.xyz\)/g) ?? [])
      .length,
    2,
  )
  const plain = litCutOf(TILE_CLASS.single, { channelless: false, closures: true })
  assert.equal(plain.closures, true)
  assert.doesNotMatch(
    closureTail(plain, 'lightOut(x)', (light) => light),
    /toonBefore/,
  )
  assert.equal(litCutOf(TILE_CLASS.single, { channelless: false }).closures, undefined)
})

test('the bounce pass of several closures reads the screen probes’ history of the closure it lights, the one-closure pass keeping its text', () => {
  const one = litPassShaders(true, { lobeless: true, closures: false }).indirect
  assert.doesNotMatch(one, /screenClosure|screenIndirectClosures|screenShortRangeGiClosures/)
  assert.equal(one, litPassShaders(true, { lobeless: true }).indirect)
  const text = litPassShaders(true, { lobeless: true, closures: true }).indirect
  assert.deepEqual(unresolvedNames(text), [])
  assert.deepEqual(reservedNames(text), [])
  assert.equal(unbalanced(text), '')
  // The pass sets the closure on entering it, before the reads that follow.
  assert.match(text, /let coverage=closureWeightAt\(coord,closure\);\n {2}screenClosure=closure;/)
  assert.match(
    text,
    new RegExp(
      `@binding\\(${DEFERRED_BINDINGS.screenIndirectClosures}\\) var screenIndirectClosures:texture_2d_array<u32>;`,
    ),
  )
  assert.match(
    text,
    new RegExp(
      `@binding\\(${DEFERRED_BINDINGS.screenShortRangeGiClosures}\\) var screenShortRangeGiClosures:texture_2d_array<f32>;`,
    ),
  )
  // The first closure, and any closure where the probes did not gather every one, reads the single-closure bindings; a closure past the first reads its layer.
  assert.match(text, /if\(screenClosure==0u\|\|!screenClosuresGathered\(\)\)/)
  assert.match(text, /textureLoad\(screenIndirectClosures,[^;]*,screenClosure,0\)/)
  assert.match(text, /textureLoad\(screenShortRangeGiClosures,[^;]*,screenClosure,0\)\.rgb/)
  assert.match(text, new RegExp(`&${SCREEN_CLOSURES_GATHERED}u\\)!=0u`))
  // The pass without the bounce has no screen probes to read: no closure number is set.
  assert.doesNotMatch(
    litPassShaders(false, { lobeless: true, closures: true }).indirect,
    /screenClosure/,
  )
})

test('the bounce layout binds the two arrays of the closures’ history only for a program of several closures', () => {
  gpuHarness()
  const bindings = (closures: boolean) =>
    indirectLayoutEntries({ bounce: true, skyShadowing: false, lobes: true, closures }).map(
      (entry) => entry.binding,
    )
  const entry = (binding: number) =>
    indirectLayoutEntries({ bounce: true, skyShadowing: false, lobes: true, closures: true }).find(
      (e) => e.binding === binding,
    )
  assert.deepEqual(
    bindings(false),
    indirectLayoutEntries({ bounce: true, skyShadowing: false, lobes: true }).map((e) => e.binding),
  )
  for (const binding of [
    DEFERRED_BINDINGS.screenIndirectClosures,
    DEFERRED_BINDINGS.screenShortRangeGiClosures,
  ]) {
    assert.ok(!bindings(false).includes(binding))
    assert.equal(entry(binding)?.texture?.viewDimension, '2d-array')
  }
  // Sampled both, so the pass holds no fifth storage texture; the words are unsigned integers.
  assert.equal(entry(DEFERRED_BINDINGS.screenIndirectClosures)?.texture?.sampleType, 'uint')
  assert.ok(!entry(DEFERRED_BINDINGS.screenShortRangeGiClosures)?.storageTexture)
  // Without the bounce there is no screen probe to read.
  assert.deepEqual(
    indirectLayoutEntries({ bounce: false, skyShadowing: false, lobes: true, closures: true }).map(
      (e) => e.binding,
    ),
    indirectLayoutEntries({ bounce: false, skyShadowing: false, lobes: true }).map(
      (e) => e.binding,
    ),
  )
})

test('each closure past the first is lit with its own specular and, where the pass holds the lobes, its own lobes', () => {
  for (const bounce of [false, true]) {
    const bare = litPassShaders(bounce, { lobeless: true, closures: true })
    const lobed = litPassShaders(bounce, { lobeless: false, closures: true })
    for (const pass of PASSES) {
      // The flags are the closure's own, past the first the layer after the coverages; the specular is read from them.
      for (const text of [bare[pass], lobed[pass]]) {
        assert.match(text, /let closureFlags=closureFlagsAt\(coord,closure\);/)
        assert.match(
          text,
          /surfaceSpecular=select\(specularOfFlags\(closureFlags\),0\.0,lightView==3u\);/,
        )
      }
      // Lobes: decoded from the closure's texel where it carries the lobe mark, none otherwise; a pass without lobes reads none.
      assert.match(lobed[pass], /lobes\.on=false;/)
      assert.match(lobed[pass], /lobesAt\(closureLobesTexel\(coord,closure\),1\.0,N,V,normal\.a\);/)
      assert.match(lobed[pass], /setLobeBase\(base\.rgb,base\.a,normal\.a\);\n {3}\}/)
      assert.doesNotMatch(bare[pass], /closureLobesTexel\(coord,closure\),1\.0|lobes\.on=false/)
    }
    assert.match(
      lobed.sun,
      /fn closureFlagsLayerOf\(held:u32,closure:u32\)->u32\{return 1u\+held\+5u\*\(closure-1u\);\}/,
    )
  }
})
