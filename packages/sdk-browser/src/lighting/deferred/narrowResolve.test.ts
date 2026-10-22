// The narrow resolve (#849): a scene of at most `TILE_LIGHTS` lights is lit by a program whose light
// array is that long, and never a wider scene by it; its cells' lists are in the pool as a wide
// scene's (#1369), walked by the same loop. A scene with no shadow slot by the program with no
// shadow code (#1249). The ambient occlusion the image drew is read by the opaque resolve alone, and applied
// to the emission, the sky light and the probes' light as the view says.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { createDeferredLighting } from './deferred.ts'
import { recorder } from './recorder.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { contractLightingShader } from '../../gpu/core/shaderTexts.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { AMBIENT_OCCLUSION_READ_WGSL } from './ambientOcclusionWgsl.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import { deferredLayoutEntries } from './layoutEntries.ts'

test("the narrow resolve bounds its light array, the rest of its program the wide one's", () => {
  for (const bounce of [false, true]) {
    const narrow = contractLightingShader(bounce, { narrow: true, lobeless: true }),
      wide = contractLightingShader(bounce)
    assert.match(narrow, new RegExp(`items:array<DirectLight,${LIGHT_SETTINGS.tileLights}>`))
    assert.match(wide, /items:array<DirectLight>/)
    // That both give the same sum, bit for bit, runs on the GPU:
    // `tests/gpu/lighting/narrow-resolve.gpu.ts`.
    const outside = (code: string) => code.replace(/items:array<DirectLight(,\d+)?>/, '')
    assert.equal(outside(narrow), outside(wide))
  }
})

test('a narrow scene is lit by the narrow program, a wide one never is', async () => {
  const gpu = fakeDevice(),
    { device } = gpu
  const lighting = await createDeferredLighting(device)
  const { labels, draw } = recorder(gpu, lighting)
  const frame = (narrow: boolean) => draw({ narrow })
  assert.equal(frame(true), false, 'unlit while the narrow program compiles')
  await lighting.settle()
  assert.equal(frame(true), true)
  // The wide twin compiled beside the narrow one: a scene past the lists is lit at once, and
  // never by the narrow program.
  assert.equal(frame(false), true, 'the wide twin is ready with the narrow program')
  assert.equal(frame(true), true)
  assert.deepEqual(labels(), [
    'DIRECT_NARROW_LIGHTING',
    'DIRECT_LIGHTING',
    'DIRECT_NARROW_LIGHTING',
  ])
  lighting.dispose()
})

test('a scene with no shadow slot is lit with no shadow code, a shadowed one never is (#1249)', async () => {
  const unshadowed = contractLightingShader(false, { unshadowed: true, lobeless: true })
  assert.doesNotMatch(unshadowed, /shade=shadowFactor\(|shadowTransmission;/, 'no shadow read')
  assert.match(contractLightingShader(false), /let shade=shadowFactor\(/)
  const gpu = fakeDevice(),
    { device } = gpu
  const lighting = await createDeferredLighting(device)
  const { labels, draw } = recorder(gpu, lighting)
  const frame = (unshadowed: boolean) => draw({ unshadowed })
  frame(true)
  await lighting.settle()
  // The twin with shadow code compiled beside it: a light that takes a shadow is lit at once.
  frame(true)
  frame(false)
  frame(true)
  assert.deepEqual(labels(), [
    'DIRECT_UNSHADOWED_LIGHTING',
    'DIRECT_LIGHTING',
    'DIRECT_UNSHADOWED_LIGHTING',
  ])
  lighting.dispose()
})

test('the opaque resolve binds the ambient occlusion and applies it by the view’s mode, a pixel with none as it was', () => {
  const at = (entries: GPUBindGroupLayoutEntry[]) =>
    entries.find((entry) => entry.binding === DEFERRED_BINDINGS.ambientOcclusion)
  assert.equal(at(deferredLayoutEntries(true, true))?.texture?.sampleType, 'unfilterable-float')
  assert.equal(at(deferredLayoutEntries(true)) !== undefined, true, 'the direct program too')
  assert.equal(at(deferredLayoutEntries(false)), undefined, 'the unlit view binds none')
  for (const bounce of [false, true]) {
    const code = contractLightingShader(bounce)
    assert.match(
      code,
      new RegExp(`@binding\\(${DEFERRED_BINDINGS.ambientOcclusion}\\) var ambientOcclusion:`),
    )
    assert.match(code, /indirect\[0\]\*occlusion\.bounce/)
    if (bounce)
      assert.match(code, /resolvedIndirect\(coord,albedo,base\.a,normal\.a,N,V,P,occlusion\.sky\)/)
    assert.match(code, /emissive\.rgb\*occlusion\.emission/)
    assert.match(code, /environmentLighting\(albedo,base\.a,N,occlusion\.sky\)/)
  }
  // The three factors by mode: none, the scene's (emission by the share, the sky by the smaller), the probes'.
  const read = (mode: number, share: number, seen: number) =>
    shaderRun<{ ambientOcclusionApplied: (c: number[], ao: number) => Record<string, number> }>(
      wgslModule(AMBIENT_OCCLUSION_READ_WGSL),
      ['ambientOcclusionApplied'],
      {
        view: { views: [0, mode, share, 0] },
        textureLoad: () => [seen, 0, 0, 1],
        ambientOcclusion: 'texture',
      },
    ).ambientOcclusionApplied([3, 4], 0.8)
  assert.deepEqual(read(0, 1, 0.5), { emission: 1, sky: 0.8, bounce: 1 })
  assert.deepEqual(read(1, 1, 0.5), { emission: 0.4, sky: 0.5, bounce: 1 })
  assert.deepEqual(read(1, 0.5, 0.5), { emission: 0.7, sky: 0.5, bounce: 1 })
  assert.deepEqual(
    read(1, 0, 0.5),
    { emission: 1, sky: 0.5, bounce: 1 },
    'a static fraction of none leaves the emission',
  )
  assert.deepEqual(read(2, 0.5, 0.4), { emission: 1, sky: 0.8, bounce: 0.7 })
})
