// The sun's distance-field shadow is bound by the sun's pass, and by the local lights' pass for the view of the
// shadows, as a storage buffer: the pass keeps its sampled textures for the shadows' mask and the clouds' shade
// (`deferred.test.ts` holds the bounce layout's count).
import test from 'node:test'
import assert from 'node:assert/strict'
import { gpuHarness } from './contractLighting.fixture.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import {
  indirectLayoutEntries,
  localLayoutEntries,
  sunLayoutEntries,
  unlitLayoutEntries,
} from './layoutEntries.ts'
import { limitOf, stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { vsmMaskWgsl } from '../direct/shadowTraceWgsl.ts'
import { DFSH_NO_MASK_WORDS } from '../distanceField/shadow/layout.ts'
import { createDeferredPlaceholders } from './setup.ts'

test('the sun’s distance-field shadow is a storage buffer of the sun’s pass and of the local lights’, for the view of the shadows', () => {
  gpuHarness()
  for (const layout of [sunLayoutEntries, localLayoutEntries])
    for (const lobes of [false, true]) {
      const entries = layout(lobes)
      const far = entries.find((entry) => entry.binding === DEFERRED_BINDINGS.farShadowMask)
      assert.equal(far?.buffer?.type, 'read-only-storage', 'lobes ' + lobes)
      assert.ok(!far?.texture && !far?.storageTexture, 'neither a sampled nor a storage texture')
      const bindGroupLayouts = [{ entries }] as unknown as GPUBindGroupLayout[]
      for (const { limit, kind, count } of stageBindingCounts({ bindGroupLayouts }))
        assert.ok(count <= limitOf(limit), `${count} ${kind}`)
    }
  assert.ok(
    !unlitLayoutEntries().some((entry) => entry.binding === DEFERRED_BINDINGS.farShadowMask),
    'a pass that lights nothing reads no sun’s shadow',
  )
})

test('the bounce layout binds the screen probes result as a sampled texture, within the default limits of its stage', () => {
  gpuHarness()
  const entries = indirectLayoutEntries({ bounce: true, skyShadowing: false, lobes: true })
  const screen = entries.find((entry) => entry.binding === DEFERRED_BINDINGS.screenIndirect)
  assert.ok(
    screen?.texture && !screen.storageTexture,
    'read by load, never a fifth storage texture',
  )
  assert.equal(screen?.texture?.sampleType, 'uint', 'the history it reads is words')
  const counts = (layout: GPUBindGroupLayoutEntry[]) =>
    stageBindingCounts({
      bindGroupLayouts: [{ entries: layout }] as unknown as GPUBindGroupLayout[],
    }).filter((c) => c.kind.endsWith('Fragment'))
  // Every pass binds what it reads alone: each layout within the stage's defaults.
  for (const layout of [
    entries,
    indirectLayoutEntries({ bounce: false, skyShadowing: true, lobes: true }),
    sunLayoutEntries(true),
    localLayoutEntries(true),
  ])
    for (const { limit, kind, count } of counts(layout))
      assert.ok(count <= limitOf(limit), `${count} ${kind}`)
  const storage = counts(entries).find((c) => c.limit === 'maxStorageTexturesPerShaderStage')
  assert.equal(
    storage?.count,
    4,
    'lobes, subsurface, reflection and the short-range global illumination: the four every device grants',
  )
  // Every key of the indirect pass — bounce or not, the sky's shadowing, the ambient cubemap, the lobes — stays within the default of the stage.
  for (const bounce of [false, true])
    for (const skyShadowing of [false, true])
      for (const lobes of [false, true])
        for (const cubed of [false, true])
          for (const { limit, kind, count } of counts(
            indirectLayoutEntries({ bounce, skyShadowing, lobes, cubed }),
          ))
            assert.ok(
              count <= limitOf(limit),
              `${count} ${kind} (bounce ${bounce}, sky ${skyShadowing}, lobes ${lobes}, cubed ${cubed})`,
            )
})

// The stand-in a frame binds where no distance-field shadow was drawn is one word, which the resolve
// tells from a real mask by its length (`vsmFarFactor`): the sun is lit there. A longer stand-in (it
// was 16 bytes) read as a mask of zeros, and every pixel was in the sun's shadow.
test('where no distance-field shadow is drawn, its stand-in leaves the sun whole', () => {
  const { device } = fakeDevice()
  const placeholders = createDeferredPlaceholders(device)
  const words = placeholders.farShadowMask.size / 4
  assert.ok(words <= DFSH_NO_MASK_WORDS, `${words} words`)
  const { vsmFarFactor } = shaderRun<{ vsmFarFactor: (channel: number) => number }>(
    vsmMaskWgsl(0, undefined, DEFERRED_BINDINGS.farShadowMask),
    ['vsmFarFactor'],
    { vsmFarMask: new Array(words).fill(0), vsmMaskPixel: [640, 360] },
  )
  for (const channel of [0, 1, 3]) assert.equal(vsmFarFactor(channel), 1, `channel ${channel}`)
  // A stand-in a backend pads past one word is told by its row's width, 0: the sun lit all the same.
  const padded = shaderRun<{ vsmFarFactor: (channel: number) => number }>(
    vsmMaskWgsl(0, undefined, DEFERRED_BINDINGS.farShadowMask),
    ['vsmFarFactor'],
    { vsmFarMask: new Array(16).fill(0), vsmMaskPixel: [0, 0] },
  )
  assert.equal(padded.vsmFarFactor(0), 1, 'padded')
})
