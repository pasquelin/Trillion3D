// Every program of the lighting's passes, the blends, the transmissive stages, the reflections, the depth
// pyramid and the ray query, of the cut — its culling, the composition of the poses, the root
// boxes, the tree's leaves and refit —, the decode of the visible clusters, the bins and the measure
// of the clusters' edges, and the deformation of the clusters, binds no more of a
// kind in one stage than WebGPU guarantees a device that asks for nothing: 16 sampled textures,
// 8 storage buffers, 4 storage textures — the engine runs on any machine at the default limits,
// whatever the world's size. The kit's device, holding the defaults, refuses a pipeline layout
// past them (`tests/kit/fakeDevice/limitRules.ts`); each test reads every stage it built too.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import { BLEND_MODES } from '../../materials/surface/materialBlending.ts'
import { WEBGPU_REQUIRED_LIMITS } from '../../session/engine/common.ts'
import { createContractVariants } from '../../lighting/deferred/contractVariants.ts'
import { FULL_CONTRACT, type ContractKey } from '../../lighting/deferred/contractCuts.ts'
import { createDeferredLighting } from '../../lighting/deferred/deferred.ts'
import { createDeferredPlaceholders } from '../../lighting/deferred/setup.ts'
import { createDeferredView } from '../../lighting/deferred/view.ts'
import { createWebgpuBlendPipelines } from '../../blend/pipelines.ts'
import type { BlendGpuItem } from '../../blend/state.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { limitOf, stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'
import { BLEND_BINDINGS } from '../bind/bindLayout.ts'
import { withinDefaults } from './stageLimits.fixture.ts'

test('the engine asks no more sampled textures a stage than WebGPU guarantees', () => {
  assert.equal(
    WEBGPU_REQUIRED_LIMITS.maxSampledTexturesPerShaderStage,
    limitOf('maxSampledTexturesPerShaderStage'),
  )
})

/** Every key a frame can ask the lighting's passes for: both list widths, each set of cuts. */
const KEYS: ContractKey[] = [false, true].flatMap((narrow) =>
  Array.from({ length: 32 }, (_, set) => ({
    narrow,
    unshadowed: !!(set & 1),
    rectless: !!(set & 2),
    sunless: !!(set & 4),
    localless: !!(set & 8),
    lobeless: !!(set & 16),
  })),
)

test("every opaque resolve program fits WebGPU's default limits", async () => {
  const { device, pipelineLayouts: layouts } = fakeDevice()
  const failures: unknown[] = []
  const onFailure = (error: unknown) => void failures.push(error)
  const unlit = await createDeferredLighting(device)
  const bindings = {
    uniform: createDeferredView(device).buffer,
    placeholders: createDeferredPlaceholders(device),
  }
  const variants = createContractVariants(device, bindings, undefined, { onFailure })
  for (const bounce of [false, true]) for (const key of KEYS) await variants.precompile(bounce, key)
  assert.deepEqual(failures, [])
  // Its targets read by load alone are read-only storage textures (`layoutEntries.ts`).
  withinDefaults(layouts, 'the lighting passes')
  variants.release()
  unlit.dispose()
})

/** Whether a layout of `layouts` shows the fragment stage the transparents' front radiance at
 *  `binding` (`../../lighting/reflections/frontLayer.ts`): a texture of words, read by load, as a
 *  read-only storage texture — none of the stage's sixteen sampled textures spent on it. */
const bindsFront = (layouts: GPUBindGroupLayoutDescriptor[], binding: number) =>
  layouts.some((layout) =>
    [...layout.entries].some(
      (entry) =>
        entry.binding === binding &&
        (entry.visibility & GPUShaderStage.FRAGMENT) !== 0 &&
        entry.storageTexture?.access === 'read-only' &&
        entry.storageTexture.format === 'rg32uint' &&
        (entry.storageTexture.viewDimension ?? '2d') === '2d',
    ),
  )

/** The most of each kind any pipeline layout of `layouts` binds in its `stage`. */
function stageCounts(layouts: GPUPipelineLayoutDescriptor[], stage: 'Fragment' | 'Vertex') {
  const worst: Record<string, number> = {}
  for (const layout of layouts)
    for (const { limit, kind, count } of stageBindingCounts(layout))
      if (kind.endsWith(stage)) worst[limit] = Math.max(worst[limit] ?? 0, count)
  return worst
}
const fragmentCounts = (layouts: GPUPipelineLayoutDescriptor[]) => stageCounts(layouts, 'Fragment')

test("the blends and the transmissive stages fit WebGPU's default limits", async () => {
  const { device, pipelineLayouts: layouts, bindGroupLayouts } = fakeDevice()
  const failures: unknown[] = []
  // One item per blending mode, every display route among them, and one that transmits: every
  // blend set, the routed ones and the transmissive stages are built.
  const items = [...BLEND_MODES, 'normal' as const].map((blending, index, all) => {
    const surface = G.basicSurface()
    Object.assign(surface, { blending })
    return { surface: surfaceOf(surface), transmissive: index === all.length - 1 }
  }) as unknown as BlendGpuItem[]
  const lit = { precompile: true, key: FULL_CONTRACT, onFailure: (e: unknown) => failures.push(e) }
  // Without the responsiveness and with it (the as-is share's key is gone with the share).
  for (const responsive of [false, true] as const) {
    const built = await createWebgpuBlendPipelines(
      device,
      items,
      undefined,
      true,
      undefined,
      responsive,
      {
        lit,
      },
    )
    assert.ok(built.blendPipelines.transmission, 'the transmissive stages are built')
  }
  assert.deepEqual(failures, [])
  // Neither casts a ray of the proxy: the trace's cast does, within its frame's budget, and the front
  // surface reads what the trace wrote, one sampled texture within the sixteen of their fragment
  // stage with the display mask's group and the reflection group; no proxy buffer nor table.
  for (const [name, bindings] of [['blends', BLEND_BINDINGS]] as const) {
    assert.ok(bindsFront(bindGroupLayouts, bindings.frontTraced), `the ${name} bind the front`)
    for (const proxy of ['proxy', 'proxyWorlds', 'proxyTree'])
      assert.ok(!(proxy in bindings), `the ${name} bind no ${proxy}`)
  }
  withinDefaults(layouts, 'the blends and the transmissive stages')
  // The fragment stage keeps room for the fog's cubemap and volume: the blue noise and the front's
  // radiance, read by load alone, are storage textures, not sampled ones.
  // Before the fog's resources were bound there, and the volume with them: 16 of 16 sampled textures,
  // 8 of 8 storage buffers, 1 of 4 storage textures, 8 of 12 uniform buffers, 2 of 16 samplers.
  // The light functions' atlas and its table, one texture of words read by load, is the third
  // storage texture: the sampled textures and the storage buffers stay as they were.
  // The shadow pool's first slice is one of the eight, one binding at every level of pages
  // (`../../lighting/shadows/vsm/poolLayout.test.ts`): a second window would be the ninth.
  // The lists of the local fog volumes over each tile of the view are the eighth and last storage buffer: a
  // texture, as a list of a tile is kept elsewhere, would pass the sixteen sampled textures this
  // stage holds with the storage textures it keeps (16 of 16); a buffer fits the eight.
  // The sky light's cubes (the reflection group's, one cube array and its sampler) are the sixteenth sampled
  // texture; its harmonics and the view's uniform are two uniform buffers. The clouds' shade and the cloud
  // image are not bound here: a translucent surface reads them per vertex, their bindings the
  // vertex stage's alone (the test below), for their maps would pass the sixteen. The graph frame
  // (the clocks and the camera an offset moves a vertex by) is the tenth uniform buffer of twelve.
  // The reflection group binds no sampler for the lit image any more (it is read by load, a level): three samplers a stage, not four.
  // The translucency lighting volume, the ambient and directional light of both cascades stacked in one half-float texture, is sampled
  // through the translucency global illumination volume's trilinear sampler, two samples a pixel (four where the light has a direction),
  // not loaded: it was the fourth storage texture, it is a sampled one. The forward programs' reflection group
  // (`reflectionForwardLayout`) binds of the reflection group only what a forward fragment reads: level 0 of the depth and its levels
  // uniform (the screen segment of a translucent surface's traced shadow), not the depth pyramid nor the lit image, which only the trace
  // reads, so the stage holds 15 of 16 sampled textures, 3 of 4 storage textures and 9 of 12 uniform buffers.
  // The translucency global illumination volume (the see-through surfaces' indirect light, one filtered fetch) is read through a sampled 3D
  // texture and a trilinear sampler, which take the sampled texture and the uniform buffer the world's probes' atlas and levels held: a surface
  // no longer gathers the probes. 16 of 16 sampled textures, 4 of 16 samplers, 9 of 12 uniform buffers.
  assert.deepEqual(fragmentCounts(layouts), {
    maxSampledTexturesPerShaderStage: 15,
    maxStorageBuffersPerShaderStage: 8,
    maxStorageTexturesPerShaderStage: 3,
    maxUniformBuffersPerShaderStage: 9,
    maxSamplersPerShaderStage: 4,
  })
  // The vertex stage holds the eight storage buffers too: the geometry's three, the items, the lights, the
  // instances, the spans with the clusters' identity words after them, and the lists of the local fog volumes it
  // lays over the fog of a vertex.
  assert.equal(stageCounts(layouts, 'Vertex').maxStorageBuffersPerShaderStage, 8)
})

test("the clouds' shade and the cloud image read per vertex are in every layout, read by the vertex stage alone", async () => {
  // The project switch `cloudShadowOnTranslucent` (the block, the map and the sampler of the one
  // light's shade) and a surface whose material has `cloudFog` (the block, the colour, the depth and
  // the sampler of the cloud image) make one flag of the programs, `reads.clouds`; both reads are
  // bound by every layout, the vertex stage's, so the fragment stage's bindings are those of the
  // programs without, whose sixteen sampled textures are spent.
  const counts = async (options: { cloudShade?: boolean; cloudFog?: boolean }) => {
    const { device, pipelineLayouts: layouts } = fakeDevice()
    const surface = G.basicSurface()
    Object.assign(surface, { blending: 'normal', cloudFog: !!options.cloudFog })
    const items = [
      { surface: surfaceOf(surface), transmissive: false },
    ] as unknown as BlendGpuItem[]
    const lit = { precompile: true, key: FULL_CONTRACT, onFailure: assert.ifError }
    const { blendPipelines } = await createWebgpuBlendPipelines(
      device,
      items,
      undefined,
      true,
      undefined,
      false,
      { lit, cloudShade: !!options.cloudShade },
    )
    withinDefaults(layouts, `the blends, the clouds per vertex ${JSON.stringify(options)}`)
    const worst: Record<string, number> = {}
    for (const layout of layouts)
      for (const { kind, count } of stageBindingCounts(layout))
        worst[kind] = Math.max(worst[kind] ?? 0, count)
    return { worst, reads: blendPipelines.reads?.clouds }
  }
  const [off, shade, fog, both] = [
    await counts({}),
    await counts({ cloudShade: true }),
    await counts({ cloudFog: true }),
    await counts({ cloudShade: true, cloudFog: true }),
  ]
  assert.deepEqual([off.reads, shade.reads, fog.reads, both.reads], [false, true, true, true])
  for (const other of [shade, fog, both])
    assert.deepEqual(other.worst, off.worst, 'one layout: the programs bind nothing more')
  // The vertex stage holds the shade's three and the cloud image's four reads, whatever the program.
  assert.ok(off.worst['sampled textures in the Vertex'] >= 3)
  assert.ok(off.worst['uniform buffers in the Vertex'] >= 3)
})
