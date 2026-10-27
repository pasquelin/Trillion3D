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
import { contractLightingShader, litPassShaders } from '../../gpu/core/shaderTexts.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  AMBIENT_OCCLUSION_READ_WGSL,
  AMBIENT_SPECULAR_OCCLUSION_WGSL,
} from './ambientOcclusionWgsl.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import { indirectLayoutEntries, unlitLayoutEntries } from './layoutEntries.ts'

test("the narrow resolve bounds its light array, the rest of its program the wide one's", () => {
  for (const bounce of [false, true]) {
    const narrow = litPassShaders(bounce, { narrow: true, lobeless: true }),
      wide = litPassShaders(bounce)
    // The passes that walk the lights: the sun's and the local lights'.
    for (const pass of ['sun', 'local'] as const) {
      assert.match(
        narrow[pass],
        new RegExp(`items:array<DirectLight,${LIGHT_SETTINGS.tileLights}>`),
      )
      assert.match(wide[pass], /items:array<DirectLight>/)
      // That both give the same sum, bit for bit, runs on the GPU:
      // `tests/gpu/lighting/narrow-resolve.gpu.ts`.
      const outside = (code: string) => code.replace(/items:array<DirectLight(,\d+)?>/g, '')
      assert.equal(outside(narrow[pass]), outside(wide[pass]))
    }
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
  assert.deepEqual(labels(), ['DIRECT_NARROW', 'DIRECT', 'DIRECT_NARROW'])
  lighting.dispose()
})

test('a scene with no shadow slot is lit with no shadow code, a shadowed one never is (#1249)', async () => {
  const unshadowed = contractLightingShader(false, { unshadowed: true, lobeless: true })
  assert.doesNotMatch(unshadowed, /shade=shadowFactor\(/, 'no shadow read')
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
  assert.deepEqual(labels(), ['DIRECT_UNSHADOWED', 'DIRECT', 'DIRECT_UNSHADOWED'])
  lighting.dispose()
})

test('the opaque resolve binds the ambient occlusion and applies it by the view’s mode, a pixel with none as it was', () => {
  const at = (entries: GPUBindGroupLayoutEntry[]) =>
    entries.find((entry) => entry.binding === DEFERRED_BINDINGS.ambientOcclusion)
  const indirect = (bounce: boolean) =>
    indirectLayoutEntries({ bounce, skyShadowing: false, lobes: false })
  assert.equal(at(indirect(true))?.texture?.sampleType, 'unfilterable-float')
  assert.equal(at(indirect(false)) !== undefined, true, 'the direct program too')
  assert.equal(at(unlitLayoutEntries()), undefined, 'the unlit view binds none')
  for (const bounce of [false, true]) {
    const code = contractLightingShader(bounce)
    assert.match(
      code,
      new RegExp(`@binding\\(${DEFERRED_BINDINGS.ambientOcclusion}\\) var ambientOcclusion:`),
    )
    assert.match(code, /indirect\[0\]\*occlusion\.bounce/)
    assert.match(
      code,
      bounce
        ? /resolvedIndirect\(coord,albedo,base\.a,normal\.a,N,V,P,occlusion\.sky,occlusion\.both,foliage\)/
        : /resolvedReflection\(coord,base\.rgb,base\.a,occlusion\.both,N,V,normal\.a\)/,
      'the reflection the field answered goes under the occlusion, in either program',
    )
    assert.match(code, /emissive\.rgb\*occlusion\.emission/)
    assert.match(code, /environmentLighting\(albedo,base\.a,N,occlusion\.sky\)/)
  }
  // The four factors by mode: none, the scene's (emission by the share, the sky by the smaller), the probes'; the
  // specular's is the material's and the image's together wherever one is drawn.
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
  assert.deepEqual(read(0, 1, 0.5), { emission: 1, sky: 0.8, bounce: 1, both: 0.8 })
  assert.deepEqual(read(1, 1, 0.5), { emission: 0.4, sky: 0.5, bounce: 1, both: 0.4 })
  assert.deepEqual(read(1, 0.5, 0.5), { emission: 0.7, sky: 0.5, bounce: 1, both: 0.4 })
  assert.deepEqual(
    read(1, 0, 0.5),
    { emission: 1, sky: 0.5, bounce: 1, both: 0.4 },
    'a static fraction of none leaves the emission, not the reflection',
  )
  assert.deepEqual(read(2, 0.5, 0.4), { emission: 1, sky: 0.8, bounce: 0.7, both: 0.8 * 0.4 })
})

test('the reflection the field answers is lifted by the facing and the roughness: saturate(pow(N·V + AO, roughness²) − 1 + AO)', () => {
  const { ambientSpecularOcclusion } = shaderRun<{
    ambientSpecularOcclusion: (ao: number, N: number[], V: number[], rough: number) => number
  }>(wgslModule(AMBIENT_SPECULAR_OCCLUSION_WGSL), ['ambientSpecularOcclusion'], {})
  const reference = (facing: number, ao: number, rough: number) =>
    Math.min(Math.max(Math.pow(facing + ao, rough * rough) - 1 + ao, 0), 1)
  const toward = (facing: number) => [Math.sqrt(1 - facing * facing), 0, facing]
  for (const [facing, ao, rough] of [
    [0.5, 0.5, 0.5],
    [0.2, 0.5, 0.8],
    [0.9, 0.3, 1],
    [0.6, 0.9, 0.1],
    [0.1, 0.05, 0.6],
  ])
    assert.ok(
      Math.abs(
        ambientSpecularOcclusion(ao, [0, 0, 1], toward(facing), rough) -
          reference(facing, ao, rough),
      ) < 1e-6,
      `N·V ${facing}, occlusion ${ao}, roughness ${rough}`,
    )
  for (const [facing, rough] of [
    [0.3, 0.7],
    [1, 0],
    [0, 1],
  ])
    assert.equal(ambientSpecularOcclusion(1, [0, 0, 1], toward(facing), rough), 1, 'none occludes')
  const none = ambientSpecularOcclusion(0, [0, 0, 1], [1, 0, 0], 0)
  assert.ok(
    Number.isFinite(none) && none === 0,
    'a grazing, fully occluded mirror: no NaN from pow(0, 0)',
  )
})
