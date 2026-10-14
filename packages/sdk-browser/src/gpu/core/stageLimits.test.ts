// Every program of the opaque resolve, the blends, the water pass, the reflections, the depth
// pyramid and the ray query, and of the cut — its culling, the composition of the poses, the root
// boxes, the tree's leaves and refit —, binds no more of a kind in one stage than WebGPU guarantees
// a device that asks for nothing: 16 sampled textures, 8 storage buffers, 4 storage textures — the
// engine runs on any machine at the default limits, whatever the world's size. The kit's device,
// holding the defaults, refuses a pipeline layout past them (`tests/kit/gpu/limitRules.ts`); each
// test reads every stage it built too.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import { BLEND_MODES } from '../../scene/materialBlending.ts'
import { WEBGPU_REQUIRED_LIMITS } from '../../engine/common.ts'
import { createContractVariants } from '../../lighting/deferred/contractVariants.ts'
import { FULL_CONTRACT, type ContractKey } from '../../lighting/deferred/contractCuts.ts'
import { createDeferredLighting } from '../../lighting/deferred/deferred.ts'
import { createDeferredPlaceholders } from '../../lighting/deferred/setup.ts'
import { createDeferredView } from '../../lighting/deferred/view.ts'
import { createWebgpuBlendPipelines } from '../../webgpu/blend/pipelines.ts'
import type { BlendGpuItem } from '../../webgpu/blend/state.ts'
import { createReflectionPipelines } from '../../reflections/reflectionPipelines.ts'
import { createHizPipelines } from '../hiz/pipelines.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { stageBindingCounts } from '../../../../../tests/kit/gpu/limitRules.ts'
import { BLEND_BINDINGS } from '../../webgpu/core/bindLayout.ts'
import { WATER_BINDINGS } from '../../webgpu/water/compositeWgsl.ts'
import { dagBindEntries } from '../dag/shader/bindings.ts'
import { dagDeviceRefusal } from '../dag/deviceRefusal.ts'
import type { PackedDag } from '../dag/types.ts'
import { TREE_REFIT_WGSL } from '../dag/treeRefitWgsl.ts'
import { TREE_LEAVES_WGSL } from '../../placement/treeLeavesWgsl.ts'
import { ROOT_BOXES_WGSL } from '../../placement/rootBoxesWgsl.ts'
import { COMPOSE_ROOTS_WGSL, COMPOSE_WORLDS_WGSL } from '../../placement/gpuComposeWgsl.ts'
import { COMPOSE_MOTION_WGSL } from '../../placement/composedMotionWgsl.ts'
import { wgslComputeLayout } from './wgslBindings.fixture.ts'
import { RAY_QUERY_WGSL } from '../../webgpu/rays/rayQueryWgsl.ts'
import { DEFORM_INDEX_SHADER } from '../../webgpu/rays/deformIndexWgsl.ts'

/** What WebGPU guarantees each stage of a device that asks for no more, by limit. */
const WEBGPU_DEFAULTS: Readonly<Record<string, number>> = {
  maxSampledTexturesPerShaderStage: 16,
  maxStorageBuffersPerShaderStage: 8,
  maxStorageTexturesPerShaderStage: 4,
}

/** Every stage of every layout of `layouts` within WebGPU's defaults, each kind; `where` names
 *  the programs. */
function withinDefaults(layouts: GPUPipelineLayoutDescriptor[], where: string) {
  assert.ok(layouts.length > 0, `${where}: built`)
  for (const layout of layouts)
    for (const { limit, kind, count } of stageBindingCounts(layout)) {
      const max = WEBGPU_DEFAULTS[limit]
      if (max !== undefined) assert.ok(count <= max, `${where}: ${count} ${kind}, past ${max}`)
    }
}

test('the engine asks no more sampled textures a stage than WebGPU guarantees', () => {
  assert.equal(
    WEBGPU_REQUIRED_LIMITS.maxSampledTexturesPerShaderStage,
    WEBGPU_DEFAULTS.maxSampledTexturesPerShaderStage,
  )
})

/** Every key a frame can ask the opaque resolve for: both list widths, each set of cuts. */
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
  // Its targets read by load alone are read-only storage textures (`deferredLayoutEntries`).
  withinDefaults(layouts, 'the opaque resolve')
  variants.release()
  unlit.dispose()
})

/** Whether a layout of `layouts` shows the fragment stage a record table at `binding` — the culling's
 *  records, the worlds and the proxy's instances (`../dag/worldTable.ts`), and its placement tree
 *  (`../dag/treeTable.ts`) —: a texture of words, no storage buffer. */
const bindsRecords = (layouts: GPUBindGroupLayoutDescriptor[], binding: number) =>
  layouts.some((layout) =>
    [...layout.entries].some(
      (entry) =>
        entry.binding === binding &&
        (entry.visibility & GPUShaderStage.FRAGMENT) !== 0 &&
        entry.texture?.sampleType === 'uint' &&
        entry.texture.viewDimension === '2d-array',
    ),
  )

test("the blends and the water pass fit WebGPU's default limits", async () => {
  const { device, pipelineLayouts: layouts, bindGroupLayouts } = fakeDevice()
  const failures: unknown[] = []
  // One item per blending mode, every display route among them, and one that transmits: every
  // blend set, the routed ones and the water stage and composite are built.
  const items = [...BLEND_MODES, 'normal' as const].map((blending, index, all) => {
    const surface = G.basicSurface()
    Object.assign(surface, { blending })
    return { surface: surfaceOf(surface), transmissive: index === all.length - 1 }
  }) as unknown as BlendGpuItem[]
  const lit = { precompile: true, key: FULL_CONTRACT, onFailure: (e: unknown) => failures.push(e) }
  for (const share of [false, true]) {
    const built = await createWebgpuBlendPipelines(
      device,
      items,
      undefined,
      true,
      undefined,
      share,
      {
        lit,
      },
    )
    assert.equal(built.waterRefused, undefined)
    assert.ok(built.water, 'the water pass is built')
  }
  assert.deepEqual(failures, [])
  // Both trace the proxy through the culling's records — its worlds and instances, one table — and
  // its tree, read in place: a sampled texture each, within the sixteen of their fragment stage with
  // the display mask's group, the reflection group binding the radiance pyramid and level 0 as one
  // texture each; the eight storage buffers left as they were.
  for (const [name, bindings] of [
    ['blends', BLEND_BINDINGS],
    ['water', WATER_BINDINGS],
  ] as const) {
    assert.ok(bindsRecords(bindGroupLayouts, bindings.proxyWorlds), `the ${name} bind the worlds`)
    assert.ok(bindsRecords(bindGroupLayouts, bindings.proxyTree), `the ${name} bind the tree`)
    assert.ok(!('proxyInstances' in bindings), `the ${name} bind no instances' table of their own`)
  }
  // The water composite's lobes target, read by load alone, is a read-only storage texture.
  withinDefaults(layouts, 'the blends and the water pass')
})

test("the reflections' and the depth pyramid's kernels fit WebGPU's defaults", async () => {
  const { device, pipelineLayouts: layouts } = fakeDevice()
  // The trace binds the reflection group (`reflectionLayout`) beside its own: the radiance
  // pyramid one texture, level 0 its opaque and front depths in one (`hizDepthEntries`).
  assert.ok(await createReflectionPipelines(device), 'the reflection kernels build')
  assert.ok(await createHizPipelines(device), 'the depth pyramid kernels build')
  withinDefaults(layouts, 'the reflections and the depth pyramid')
})

test("the cut's programs fit WebGPU's default limits, whatever the world", () => {
  // The culling's one layout, whatever the device splits nothing: its tables are record tables.
  withinDefaults([{ bindGroupLayouts: [{ entries: dagBindEntries() }] as never }], 'the culling')
  for (const [name, text] of [
    ['the refit', TREE_REFIT_WGSL],
    ['the tree leaves', TREE_LEAVES_WGSL],
    ['the root boxes', ROOT_BOXES_WGSL],
    ['the compose roots', COMPOSE_ROOTS_WGSL],
    ['the compose worlds', COMPOSE_WORLDS_WGSL],
    ['the compose motion', COMPOSE_MOTION_WGSL],
    // The ray query reads the cut's nodes, frame words, worlds and tree where the culling reads
    // them, at its bindings: four sampled textures, whatever the world's size.
    ['the ray trace', RAY_QUERY_WGSL],
    ['the deformation index', DEFORM_INDEX_SHADER],
  ] as const)
    withinDefaults([wgslComputeLayout(text)], name)
})

test('a device whose binding holds two thirds of the frame words binds the cut at the defaults', () => {
  // The frame-ranges proof's split case (`tests/gpu/dag/frame-ranges.gpu.ts`): its binding holds
  // two thirds of 600 placements' frame words, once past what its stage bound in parts, and
  // `work` whole: 8,704 bytes for a thousand pages — sixteen blocks of six words, thirty counters
  // and rows, the eviction sort's 2,050 words (`POOL_SORT_WORDS`); its scratch lies in `flags`.
  const packed = {
    pageCount: 1000,
    nodeCount: 10,
    worldCount: 600,
    ...Object.fromEntries(
      ['clusters', 'nodes', 'worlds', 'pageCones'].map((name) => [name, new Float32Array(16)]),
    ),
  } as unknown as PackedDag
  const limits = { maxStorageBufferBindingSize: 400 * 32, ...WEBGPU_DEFAULTS }
  assert.equal(dagDeviceRefusal(limits, packed), undefined, 'the device holds the cut')
  withinDefaults([{ bindGroupLayouts: [{ entries: dagBindEntries() }] as never }], 'its culling')
})
