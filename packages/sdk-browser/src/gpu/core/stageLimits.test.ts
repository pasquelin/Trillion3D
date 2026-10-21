// Every program of the opaque resolve, the blends, the transmissive stages, the reflections, the depth
// pyramid and the ray query, of the cut — its culling, the composition of the poses, the root
// boxes, the tree's leaves and refit —, and both halves of the draw compaction, binds no more of a
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
import { createReflectionPipelines } from '../../lighting/reflections/reflectionPipelines.ts'
import { createHizPipelines } from '../../visibility/hiz/gpu/pipelines.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { limitOf, stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'
import { BLEND_BINDINGS } from '../bind/bindLayout.ts'
import { dagBindEntries } from '../../geometry/dag/shader/bindings.ts'
import { drawBindEntries } from '../../visibility/draw/shader.ts'
import { dagDeviceRefusal } from '../../geometry/dag/deviceRefusal.ts'
import type { PackedDag } from '../../geometry/dag/types.ts'
import { TREE_REFIT_WGSL } from '../../geometry/dag/tree/treeRefitWgsl.ts'
import { TREE_LEAVES_WGSL } from '../../placement/tree/treeLeavesWgsl.ts'
import { ROOT_BOXES_WGSL } from '../../placement/roots/rootBoxesWgsl.ts'
import { COMPOSE_ROOTS_WGSL, COMPOSE_WORLDS_WGSL } from '../../placement/compose/gpuComposeWgsl.ts'
import { COMPOSE_MOTION_WGSL } from '../../placement/compose/composedMotionWgsl.ts'
import { wgslComputeLayout } from './wgslBindings.fixture.ts'
import { RAY_QUERY_WGSL } from '../../lighting/rays/rayQueryWgsl.ts'
import { DEFORM_INDEX_SHADER } from '../../lighting/rays/deformIndexWgsl.ts'

/** Every stage of every layout of `layouts` within WebGPU's defaults (`limitOf`, the kit device's
 *  one table), each kind; `where` names the programs. */
function withinDefaults(layouts: GPUPipelineLayoutDescriptor[], where: string) {
  assert.ok(layouts.length > 0, `${where}: built`)
  for (const layout of layouts)
    for (const { limit, kind, count } of stageBindingCounts(layout)) {
      const max = limitOf(limit)
      assert.ok(count <= max, `${where}: ${count} ${kind}, past ${max}`)
    }
}

test('the engine asks no more sampled textures a stage than WebGPU guarantees', () => {
  assert.equal(
    WEBGPU_REQUIRED_LIMITS.maxSampledTexturesPerShaderStage,
    limitOf('maxSampledTexturesPerShaderStage'),
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

/** Whether a layout of `layouts` shows the fragment stage the transparents' front radiance at
 *  `binding` (`../../lighting/reflections/frontLayer.ts`): a texture of words, read by load, no storage. */
const bindsFront = (layouts: GPUBindGroupLayoutDescriptor[], binding: number) =>
  layouts.some((layout) =>
    [...layout.entries].some(
      (entry) =>
        entry.binding === binding &&
        (entry.visibility & GPUShaderStage.FRAGMENT) !== 0 &&
        entry.texture?.sampleType === 'uint' &&
        (entry.texture.viewDimension ?? '2d') === '2d',
    ),
  )

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
  for (const share of [0, 2] as const) {
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
  // `work` whole: 668 bytes for a thousand pages — sixteen blocks of eight words, twenty-seven frame
  // counters and the lists' twelve group words (`dagWorkLayout`).
  const packed = {
    pageCount: 1000,
    nodeCount: 10,
    worldCount: 600,
    ...Object.fromEntries(
      ['clusters', 'nodes', 'worlds', 'coldWords'].map((name) => [name, new Float32Array(16)]),
    ),
  } as unknown as PackedDag
  // Every other limit at WebGPU's default: the check reads a limit the device leaves out as such.
  const limits = { maxStorageBufferBindingSize: 400 * 32 }
  assert.equal(dagDeviceRefusal(limits, packed), undefined, 'the device holds the cut')
  withinDefaults([{ bindGroupLayouts: [{ entries: dagBindEntries() }] as never }], 'its culling')
})

test("the draw compaction fits WebGPU's default limits", () => {
  // Both halves bind the one layout: the groups' offsets, counts and slot totals in one buffer.
  withinDefaults(
    [{ bindGroupLayouts: [{ entries: drawBindEntries() }] as never }],
    'the draw compaction',
  )
})
