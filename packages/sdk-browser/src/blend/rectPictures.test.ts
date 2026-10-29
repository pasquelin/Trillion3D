// The blends read the rectangle lights' pictures on a device that grants the seventeenth sampled texture of the widest fragment stage
// (`gpu/core/rectPictures.ts`) and light a rectangle plain on one that grants sixteen: the layout, the bind entries and the module agree
// either way, and no pipeline layout passes the limits its device holds.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { surfaceOf } from '../geometry/pages/surface.ts'
import { BLEND_MODES } from '../materials/surface/materialBlending.ts'
import { FULL_CONTRACT } from '../lighting/deferred/contractCuts.ts'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { limitOf, stageBindingCounts } from '../../../../tests/kit/fakeDevice/limitRules.ts'
import { BLEND_RECT_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { blendBindEntries, blendLayoutEntries } from '../gpu/bind/blendBindEntries.ts'
import { grantsRectPictures } from '../gpu/core/rectPictures.ts'
import { blendGroupLayouts } from './groupLayouts.ts'
import { blendShader } from './shader.ts'
import { createWebgpuBlendPipelines } from './pipelines.ts'
import type { BlendGpuItem } from './state.ts'

const atlasDeclaration = `@binding(${BLEND_RECT_BINDINGS.atlas}) var rectAtlas:texture_2d<f32>;`

test('the device grants the pictures from the seventeenth sampled texture', () => {
  assert.equal(
    grantsRectPictures({ limits: { maxSampledTexturesPerShaderStage: 16 } } as never),
    false,
  )
  assert.equal(
    grantsRectPictures({ limits: { maxSampledTexturesPerShaderStage: 17 } } as never),
    true,
  )
  assert.equal(
    grantsRectPictures({ limits: { maxSampledTexturesPerShaderStage: 128 } } as never),
    true,
  )
  assert.equal(grantsRectPictures({} as never), false)
})

test('the layout, the entries and the module hold the pictures together, or none of them', () => {
  fakeDevice() // WebGPU's globals, which the layouts name their stages by
  const plain = blendLayoutEntries(208)
  const pictured = blendLayoutEntries(208, false, true)
  const at = (entries: GPUBindGroupLayoutEntry[]) => entries.map((e) => e.binding)
  assert.ok(!at(plain).includes(BLEND_RECT_BINDINGS.atlas))
  assert.deepEqual(
    at(pictured).filter((b) => !at(plain).includes(b)),
    [BLEND_RECT_BINDINGS.atlas, BLEND_RECT_BINDINGS.sampler],
  )
  const resources = new Proxy({}, { get: () => ({}) }) as never
  const entries = (rect: boolean) => blendBindEntries(resources, rect).map((e) => e.binding)
  assert.deepEqual(
    entries(true).filter((b) => !entries(false).includes(b)),
    [BLEND_RECT_BINDINGS.atlas, BLEND_RECT_BINDINGS.sampler],
  )
  // A scene that lights its rectangles as rectangles (`translucentRectLights`) reads the pictures where the device grants them.
  const scene = { rectLights: true, contact: false }
  assert.ok(blendShader({}, { scene, rectPictures: true }).includes(atlasDeclaration))
  assert.ok(!blendShader({}, { scene }).includes(atlasDeclaration))
})

/** The blends and the display-filtered ones built on a device granting `sampled` sampled textures a stage: the fragment stage's widest
 *  count of the pipelines that bind the display mask, and of the others. */
async function build(sampled: number) {
  const { device, pipelineLayouts: layouts } = fakeDevice({
    limits: { maxSampledTexturesPerShaderStage: sampled },
  })
  const items = [...BLEND_MODES, 'normal' as const].map((blending) => {
    const surface = G.basicSurface()
    Object.assign(surface, { blending, contactShadows: true })
    return { surface: surfaceOf(surface), transmissive: false }
  }) as unknown as BlendGpuItem[]
  const lit = { precompile: true, key: FULL_CONTRACT, onFailure: assert.ifError }
  await createWebgpuBlendPipelines(device, items, undefined, true, undefined, false, { lit })
  const widest = { masked: 0, others: 0 }
  for (const layout of layouts) {
    const groups = (layout as unknown as { bindGroupLayouts: unknown[] }).bindGroupLayouts.length
    for (const { limit, kind, count } of stageBindingCounts(layout)) {
      assert.ok(count <= limitOf(limit, device.limits as never), `${kind}: ${count}`)
      if (limit === 'maxSampledTexturesPerShaderStage' && kind.endsWith('Fragment')) {
        const key = groups === 3 ? 'masked' : 'others'
        widest[key] = Math.max(widest[key], count)
      }
    }
  }
  return widest
}

test('on a device granting 16 only the display-filtered pipelines go without the pictures; on one granting 17 all read them', async () => {
  // 15 sampled textures of the blend and the reflection groups, the pictures a sixteenth; the mask a seventeenth.
  assert.deepEqual(await build(16), { masked: 16, others: 16 })
  assert.deepEqual(await build(17), { masked: 17, others: 16 })
})

test('the two layouts come from one builder: one layout where the device grants the seventeenth, two where it grants sixteen', () => {
  const layouts = (sampled: number) =>
    blendGroupLayouts(fakeDevice({ limits: { maxSampledTexturesPerShaderStage: sampled } }).device)
  const [small, large] = [layouts(16), layouts(17)]
  assert.equal(small.pictures, false)
  assert.notEqual(small.full, small.filtered)
  const binds = (layout: GPUBindGroupLayout) =>
    [...(layout as unknown as { entries: Iterable<GPUBindGroupLayoutEntry> }).entries].map(
      (e) => e.binding,
    )
  assert.ok(binds(small.full).includes(BLEND_RECT_BINDINGS.atlas))
  assert.ok(!binds(small.filtered).includes(BLEND_RECT_BINDINGS.atlas))
  assert.equal(large.pictures, true)
  assert.equal(large.full, large.filtered)
})

test('on a device granting 16 the display-filtered module lights a rectangle plain and the others read the pictures', () => {
  const scene = { rectLights: true, contact: false }
  assert.ok(blendShader({}, { scene, rectPictures: true }).includes(atlasDeclaration))
  assert.ok(!blendShader({}, { scene, rectPictures: false }).includes(atlasDeclaration))
})
