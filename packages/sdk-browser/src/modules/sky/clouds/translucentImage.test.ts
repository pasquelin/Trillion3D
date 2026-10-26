// The image of the clouds the translucent surfaces read: when the fog is laid on it (the setup), the
// reconstruction that lays it (`reconstructWgsl.ts`), and what the image leaves for the blended pass
// (`cloudShownOf`). Split from `orthographic.test.ts` and `trace.test.ts`: 300 lines at most a file.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { SKY_QUALITY_RULES } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/fakeDevice/globals.ts'
import { CLOUD_TRACE_SIZES } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import { cloudSetupOf } from './cloudModes.ts'
import { cloudShownOf } from './cloudShown.ts'
import { describeReconstruct, type CloudFramePlan } from './reconstruct.ts'

const quality = (options: object) => resolveSettings(SKY_QUALITY_RULES, options)

test('the fog is laid on the image for the translucent surfaces only where it is asked, with the fog laid late', () => {
  const on = { cloudFogLateOnTranslucent: true }
  assert.equal(cloudSetupOf(quality({})).lateFogOnTranslucent, false, 'off by default')
  // The traces that rebuild an image (quarter to half, quarter to full) lay the fog late.
  for (const size of ['quarterToHalf', 'quarterToFull'] as const)
    assert.equal(cloudSetupOf(quality({ ...on, cloudTraceSize: size })).lateFogOnTranslucent, true)
  // The traces that do not rebuild take the fog in the trace: no image to lay it on.
  for (const size of ['half', 'full'] as const)
    assert.equal(cloudSetupOf(quality({ ...on, cloudTraceSize: size })).lateFogOnTranslucent, false)
  assert.equal(cloudSetupOf(quality({ ...on, cloudFogLate: false })).lateFogOnTranslucent, false)
  assert.equal(cloudSetupOf(quality(on), true, false).lateFogOnTranslucent, false, 'a direct trace')
  assert.deepEqual(
    CLOUD_TRACE_SIZES.map((size) => cloudSetupOf(quality({ ...on, cloudTraceSize: size })).lateFog),
    [true, false, true, false],
    'it asks for what is laid late',
  )
})

/** The reconstruction of an image with a history, wearing the quality settings `options`. */
function reconstructionOf(options: object) {
  const size = { texture: { width: 1, height: 1 }, view: { width: 1, height: 1 } }
  const plan = {
    setup: cloudSetupOf(quality(options)),
    sizes: { reconstructed: size, traced: size },
    history: size,
  } as unknown as CloudFramePlan
  return describeReconstruct(plan)!
}

test('the reconstruction writes the image with the fog on it as one more target, within the bytes the targets of a pass may hold', () => {
  installGpuGlobals()
  // A texel of the cloud format is four half floats; 32 bytes a sample is the most a device holds by default.
  const [texelBytes, mostBytes] = [8, 32]
  for (const cloudTraceSize of ['quarterToHalf', 'quarterToFull'] as const) {
    const plain = reconstructionOf({ cloudTraceSize })
    const fogged = reconstructionOf({ cloudTraceSize, cloudFogLateOnTranslucent: true })
    assert.equal(fogged.targets.length, plain.targets.length + 1, 'the fogged colour, one more')
    assert.ok(fogged.targets.length * texelBytes <= mostBytes, `${cloudTraceSize}`)
    assert.ok(fogged.targets.every((format) => format === 'rgba16float'))
    assert.match(
      fogged.code,
      new RegExp(`@location\\(${fogged.targets.length - 1}\\) fogged:vec4f`),
    )
    assert.equal(plain.air, undefined, 'its own group alone')
    assert.doesNotMatch(plain.code, /fogged/)
    assert.ok(fogged.air, 'the air’s group first, the fog read from it')
  }
})

/** A frame whose reconstructed image is `texture` texels with `fills` of them filled, wearing the
 *  quality settings `options`, at frame number 7 with a pre-exposure of 2. */
function frameOf(options: object, fills: number[], texture: number[]) {
  const setup = cloudSetupOf(quality({}))
  const size = (width: number, height: number) => ({ width, height })
  const plan = {
    setup,
    sizes: {
      reconstructed: { texture: size(texture[0], texture[1]), view: size(fills[0], fills[1]) },
      traced: { texture: size(1, 1), view: size(1, 1) },
    },
  } as unknown as CloudFramePlan
  return {
    plan,
    image: { preExposure: 2, frameIndex: 7 },
    part: { quality: quality(options) },
  } as unknown as Parameters<typeof cloudShownOf>[0]
}

test('what the image leaves for the translucent surfaces is scaled to the part of the texture it fills, held off its edge', () => {
  const colour = {} as GPUTextureView
  const shown = { views: { colour: {} as GPUTextureView, depth: {} as GPUTextureView } }
  const left = cloudShownOf(frameOf({}, [480, 270], [512, 288]), shown, colour)
  assert.equal(left.colour, colour, 'the colour handed in, not the image’s own')
  assert.equal(left.depth, shown.views.depth)
  assert.deepEqual(left.uvScale, [480 / 512, 270 / 288])
  assert.deepEqual(left.uvMax, [(480 - 0.51) / 512, (270 - 0.51) / 288])
  assert.equal(left.preExposure, 2)
  assert.equal(left.frame, 7)
  assert.equal(left.softBlendingKm, 0.5, 'half a kilometre by default')
})

test('the soft blending is the setting, read from a ten-thousandth of a kilometre', () => {
  const softOf = (km: number) =>
    cloudShownOf(
      frameOf({ cloudSoftBlendingDistanceOnTranslucent: km }, [2, 2], [2, 2]),
      { views: { colour: {} as GPUTextureView, depth: {} as GPUTextureView } },
      {} as GPUTextureView,
    ).softBlendingKm
  assert.deepEqual([softOf(2), softOf(0), softOf(-3)], [2, 1e-4, 1e-4])
})
