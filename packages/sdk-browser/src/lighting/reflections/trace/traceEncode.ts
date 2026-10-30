import { buildComputeStages } from '../../../gpu/core/computeStages.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import {
  REFLECTION_BILATERAL_PASS,
  REFLECTION_CLEAR_PASS,
  REFLECTION_HIT_LIGHTING_PASS,
  REFLECTION_KEEP_DEPTH_PASS,
  REFLECTION_RESOLVE_PASS,
  REFLECTION_SCENE_PASS,
  REFLECTION_TEMPORAL_PASS,
  REFLECTION_TRACE_PASS,
} from '../../../diagnostic/stage/passLabels.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { REFLECTION_SIDE } from '../constants.ts'
import { resetListIn } from '../../../gpu/dispatch/list.ts'
import { REFLECTION_GROUP } from '../viewLayout.ts'
import { encodeClosureFlags } from '../closureFlags.ts'
import type { SurfaceBuffer } from '../../../materials/surface/surfaceBuffer.ts'
import type { ClosureSide } from '../closureSides.ts'
import type { ClosureTiles } from '../../../visibility/closureTiles/closureTiles.ts'
import { classifyGroups } from '../tiles.ts'
import type { MeshStageRun } from '../../bounce/screen/meshStage.ts'
import { reflectionMeshLists } from './meshes.ts'
import { closureClassifyGroups, closureClassifyKernels, listGroups } from './closureClassify.ts'
import { closureArgsAt } from '../../../visibility/closureTiles/closureTilesWgsl.ts'
import { TRACE_MESH_GROUP, TRACE_MESH_LIST } from '../../bounce/screen/traceMeshWgsl.ts'
import type { RadianceCacheStage } from '../radianceCache/stage.ts'
import {
  encodeHitLighting,
  resetHitLighting,
  type HitLightingRun,
  type LitSide,
} from '../hitLighting/stage.ts'
import { REFLECTION_HARDWARE_SCENE } from './traceBindings.ts'
import { hardwareTraceGroups } from './traceHardwareGroups.ts'
import {
  KERNELS,
  traceGroups,
  type TraceInputs,
  type TraceLayouts,
  type TraceResources,
} from './traceGroups.ts'

/** The kernels' entries on their module, the opaque surface's then the front one's. */
const ENTRIES = {
  generate: ['generateRays', 'generateRays'],
  screen: ['traceScreen', 'traceScreen'],
  clearTracing: ['clearTracing', 'clearTracing'],
  scene: ['traceScene', 'traceScene'],
  clear: ['clearOpaque', 'clearFront'],
  resolve: ['resolveSurface', 'resolveSurface'],
  temporal: ['temporalSurface', 'temporalSurface'],
  bilateral: ['bilateralOpaque', 'bilateralFront'],
} as const

/** The reflections' kernels on the trace's module (`REFLECTION_TRACE_SHADER`) — the classification
 *  (`../tiles.ts`) and each surface's —, over the reflection group's layout `groupLayout`
 *  (`reflectionLayout`) and their groups 0's layouts `layouts` (`traceLayouts`), made by the caller
 *  before its first `await`, in its validation scope. */
export async function createTraceStages(
  device: GPUDevice,
  modules: { trace: GPUShaderModule },
  groupLayout: GPUBindGroupLayout,
  layouts: TraceLayouts,
) {
  const kernelLayouts = (layer: number) =>
    ({
      generate: layouts.generate,
      screen: layouts.screen,
      clearTracing: layouts.clearTracing,
      scene: layouts.scene,
      clear: layer === 0 ? layouts.clear : layouts.clearFront,
      resolve: layouts.resolve,
      temporal: layouts.temporal,
      bilateral: layer === 0 ? layouts.bilateral : layouts.bilateralFront,
    }) as const
  // The surface's layer, the pipeline's (`REFLECTION_LAYER_WGSL`): 0 the opaque, 1 the front.
  const surface = async (layer: number) => {
    const own = kernelLayouts(layer)
    const built = await Promise.all(
      KERNELS.map((kernel) =>
        buildComputeStages(
          device,
          [own[kernel], groupLayout],
          modules.trace,
          [ENTRIES[kernel][layer]],
          { REFLECTION_LAYER: layer },
        ).then((s) => s[ENTRIES[kernel][layer]]),
      ),
    )
    return Object.fromEntries(KERNELS.map((kernel, at) => [kernel, built[at]])) as Record<
      (typeof KERNELS)[number],
      GPUComputePipeline
    >
  }
  const [opaque, front, classify, keepDepth] = await Promise.all([
    surface(0),
    surface(1),
    buildComputeStages(device, [layouts.classify, groupLayout], modules.trace, ['classifyTiles']),
    buildComputeStages(device, [layouts.keepDepth, groupLayout], modules.trace, ['keepDepth']),
  ])
  return {
    layouts,
    /** The reflection group's layout, which the kernels of a closure past the first (`closureClassify.ts`) are made over. */
    group: groupLayout,
    opaque,
    front,
    classify: classify.classifyTiles,
    keepDepth: keepDepth.keepDepth,
  }
}
type TraceStages = Awaited<ReturnType<typeof createTraceStages>>

/** The scene stage that casts its rays through the scene's triangles, compiled: its pipeline for the opaque surface (0) and the
 *  transparents' front one (1) (`hardwareReflectionKernels`, `../reflectionPipelines.ts`). */
interface HardwareStage {
  /** The trace of the rays through the triangles, then `pipeline` answers from what they met. */
  hit(layer: number): GPUComputePipeline
  pipeline(layer: number): GPUComputePipeline
  /** The format of the surface cache's final light the stage is for (`lightAtlasFormat`). */
  readonly light: LightAtlasFormat
  /** Whether the stage marks the hits to light again, the records of its hits being a word longer (`reflectionHitWords`). */
  readonly lit: boolean
}

/** The trace's passes, each timed alone under its label: the clear of the unused tracing tiles, the ray generation and the screen stage (the
 *  classification first, the clear then the generation before the screen march), the scene stage, the denoising — the last pass's clear
 *  over the clear tiles, then the resolve, the accumulation and the last pass over the resolve tiles, each its own pass, the depth kept for the next image last —;
 *  and their kernels. */
const PASSES = [
  { label: REFLECTION_TRACE_PASS, kernels: ['clearTracing', 'generate', 'screen'] },
  { label: REFLECTION_SCENE_PASS, kernels: ['scene'] },
  { label: REFLECTION_HIT_LIGHTING_PASS, kernels: [] },
  { label: REFLECTION_CLEAR_PASS, kernels: ['clear'] },
  { label: REFLECTION_RESOLVE_PASS, kernels: ['resolve'] },
  { label: REFLECTION_TEMPORAL_PASS, kernels: ['temporal'] },
  { label: REFLECTION_BILATERAL_PASS, kernels: ['bilateral'] },
  { label: REFLECTION_KEEP_DEPTH_PASS, kernels: [] },
] as const satisfies readonly { label: string; kernels: readonly (typeof KERNELS)[number][] }[]

/** The list each kernel is dispatched over. */
const LISTS = {
  generate: 'tracing',
  screen: 'tracing',
  clearTracing: 'clearTracing',
  scene: 'pending',
  clear: 'clear',
  resolve: 'resolve',
  temporal: 'resolve',
  bilateral: 'resolve',
} as const satisfies Record<(typeof KERNELS)[number], string>

/** The surfaces a trace answers: the opaque one alone, or the front one after it. */
const OPAQUE = ['opaque'] as const
const BOTH = ['opaque', 'front'] as const

/** Whether the resolve of `side` reads the rays of texels outside its own tile: it reconstructs from its neighbours, or its blocks are larger than a pixel. */
const readsNeighbours = (
  side: (typeof BOTH)[number],
  block: readonly [number, number],
  frontBlock: readonly [number, number],
  reconstruct: readonly [boolean, boolean],
) => {
  const [x, y] = side === 'opaque' ? block : frontBlock
  return reconstruct[side === 'opaque' ? 0 : 1] || x !== 1 || y !== 1
}

/** The classification's workgroups, written in place each image (`classifyGroups`). */
const classifying: [number, number] = [0, 0]

/** Each list's head as an image starts it, of each side the image traces: one copy a list. */
function resetHeads(
  encoder: GPUCommandEncoder,
  reflection: TraceResources,
  sides: readonly ('opaque' | 'front')[],
) {
  for (const side of sides) {
    const { lists } = side === 'opaque' ? reflection.grids : reflection.front.grids
    for (const list of lists) resetListIn(reflection.device, encoder, list)
  }
}

/** What the traced reflections of the closures past the first read of the frame: the surface record (the words and the closures' normals) and the closure tiles whose overflow regions they run over. */
export interface ClosureInputs {
  surfaces: Pick<SurfaceBuffer, 'words' | 'closureNormals' | 'closures'>
  tiles: ClosureTiles | undefined
}

/** The ranks of the closure sides traced this image, written in place each image (`closuresTraced`). */
const tracedSides: number[] = []

/** The closure sides traced this image, by their rank among the sides: those whose groups exist and whose flags were written (`encodeClosureFlags`), their lists emptied as an image starts them. */
function closuresTraced(
  encoder: GPUCommandEncoder,
  reflection: TraceResources,
  groups: readonly (unknown | undefined)[],
  closures: ClosureInputs | undefined,
  classifier: unknown,
) {
  const traced = tracedSides
  traced.length = 0
  const sides = reflection.closureSides?.sides
  if (!closures || !sides || !classifier) return traced
  for (let at = 0; at < sides.length; at++) {
    const side = sides[at]!
    if (!groups[at]) continue
    if (
      !encodeClosureFlags(
        reflection.device,
        encoder,
        closures.surfaces,
        closures.tiles,
        side.closure,
        side.flags,
        side.flagsView,
        side.lobesView,
      )
    )
      continue
    for (const list of side.grids.lists) resetListIn(reflection.device, encoder, list)
    resetListIn(reflection.device, encoder, side.marked)
    traced.push(at)
  }
  return traced
}

/** The hit lighting's view of a closure past the first, kept while its textures stay. */
const litSides = new WeakMap<ClosureSide, { normals: GPUTextureView; side: LitSide }>()

/** The closure sides traced this image as the hit lighting lights them, written in place each image. */
const litScratch: LitSide[] = []

/** `side` as the hit lighting lights its traces: its grids and the pixels it traces for. */
function litSideOf(side: ClosureSide, inputs: TraceInputs): LitSide {
  const normals = inputs.closureNormals![side.closure - 1]!
  let held = litSides.get(side)
  if (!held || held.normals !== normals || held.side.pixels.lobes !== side.lobesView) {
    held = {
      normals,
      side: {
        grids: side.grids,
        pixels: { flags: side.flagsView, normals, lobes: side.lobesView },
      },
    }
    litSides.set(side, held)
  }
  return held.side
}

/** The stage's two dispatches in the scene pass, before the scene stage: the first compaction over the list of the rays the screen missed, then the trace over the list it made. Group 1 is set (the reflection group). */
function dispatchReflectionMeshes(
  pass: GPUComputePassEncoder,
  groups: Record<'meshCompact' | 'meshTrace', readonly GPUBindGroup[]>,
  parity: number,
  meshes: MeshStageRun,
  lists: { pending: GPUBuffer; meshRays?: GPUBuffer },
  traced?: readonly [GPUBindGroup, GPUBindGroup],
) {
  if (!lists.meshRays) return
  for (const [at, stage, texels, over] of [
    [0, meshes.compact, groups.meshCompact, lists.pending],
    [1, meshes.trace, groups.meshTrace, lists.meshRays],
  ] as const) {
    pass.setPipeline(stage.pipeline)
    pass.setBindGroup(0, texels[parity])
    pass.setBindGroup(TRACE_MESH_GROUP, stage.group)
    // The list of the rays traced is the surface's own (a closure past the first has its grids').
    pass.setBindGroup(TRACE_MESH_LIST, traced ? traced[at] : stage.list)
    pass.dispatchWorkgroupsIndirect(over, 0)
  }
}

/** The scene stage through the scene's triangles over the list `over`: the trace of the rays, then the answer from the triangles they met (the second dispatch sees the first's writes), for the surface of the layer `layer` whose groups are `hit` and `answer`. */
function dispatchHardwareScene(
  pass: GPUComputePassEncoder,
  traced: {
    stage: HardwareStage
    groups: { maskedScene: GPUBindGroup; scene: GPUBindGroup }
  },
  layer: number,
  hit: GPUBindGroup,
  answer: GPUBindGroup,
  over: GPUBuffer,
) {
  pass.setPipeline(traced.stage.hit(layer))
  pass.setBindGroup(0, hit)
  pass.setBindGroup(REFLECTION_HARDWARE_SCENE.group, traced.groups.maskedScene)
  pass.dispatchWorkgroupsIndirect(over, 0)
  pass.setPipeline(traced.stage.pipeline(layer))
  pass.setBindGroup(0, answer)
  pass.setBindGroup(REFLECTION_HARDWARE_SCENE.group, traced.groups.scene)
  pass.dispatchWorkgroupsIndirect(over, 0)
}

/**
 * The reflections of the pixels of `size` in the trace's three passes on `encoder` (`PASSES`), each
 * opened, filled and ended in turn (`trace.ts`): for the opaque surface — and, with `front`, the image's
 * front pass having written a reflecting surface, for the front one —, its lists emptied on the encoder,
 * its tiles classified (`../tiles.ts`) over the grid of this image's blocks, its rays generated (the kernel `generateRays`, after the clear of the
 * unused tiles, as the reference's pass of its own is) and traced on the screen; the rays the screen missed traced through the scene; then resolved, accumulated and filtered
 * over the resolve tiles, and answered by the field over the clear ones. Every kernel after the
 * classification is dispatched indirectly: over a list of tiles, the scene stage over the rays missed.
 * `depthGroup` is the reflection group over the depth pyramid, `block` the blocks of pixels a grid texel
 * traces, across and down (the level's row), `frontBlock` the front layer's, `grid` the grid this image uses (`usedAxis` of them along each axis: what the buffers of the scene stage's hits and of the hit lighting are sized on), `reconstruct` whether the opaque surface's and
 * the front one's resolve reads the neighbours' rays. The clear of the unused tracing tiles runs only where a resolve reads
 * a texel of another tile: a surface reconstructing, or tracing for blocks larger than one pixel. With `hardware` and the scene
 * trace of the image (`inputs.rays`) the scene stage is the program that casts its rays through the scene's triangles
 * (`../sceneTraceHardware.ts`), over its own groups (`traceHardwareGroups.ts`). With `meshes` (`meshes.ts`) the opaque surface's scene pass starts with the meshes' fields stage over the
 * rays the screen missed. With `cache` (`../radianceCache/stage.ts`) the opaque surface's rays are shortened before the screen stage and the ones that met nothing
 * within their distance read the radiance cache after the scene stage. The history's parity turns every call.
 * With `closures` and the sides of the closures past the first (`TraceResources.closureSides`), each such closure is traced after the opaque surface, by the same
 * kernels over its own textures (the reference's `Reflections.cpp:1511-1823`, a classification, a trace and a resolve for each closure of the overflow region): its flags written first, over its
 * overflow tiles (`closureFlags.ts`); its tiles classified over those overflow tiles (`closureClassify.ts`: marked, listed, classified), not over the grid; and its scene path is the opaque surface's:
 * the meshes' fields stage, the radiance cache's limits and reads, the trace through the triangles and the hit lighting, each over the closure's own lists. A closure no trace has written
 * yet gets the first closure's layers (`ClosureSide.copyFirst`).
 */
export function encodeReflectionTrace(
  encoder: GPUCommandEncoder,
  reflection: TraceResources,
  stages: TraceStages,
  inputs: TraceInputs,
  depthGroup: GPUBindGroup,
  size: readonly [number, number],
  block: readonly [number, number],
  frontBlock: readonly [number, number],
  grid: readonly [number, number],
  reconstruct: readonly [boolean, boolean],
  front: boolean,
  hardware?: HardwareStage,
  meshes?: MeshStageRun,
  cache?: RadianceCacheStage,
  lit?: HitLightingRun,
  closures?: ClosureInputs,
) {
  const groups = traceGroups(reflection, stages, stages.layouts, inputs)
  const traced =
    hardware && inputs.rays
      ? {
          stage: hardware,
          groups: hardwareTraceGroups(reflection, inputs, inputs.rays, hardware.light, {
            lit: hardware.lit,
            grid,
          }),
        }
      : undefined
  const parity = (reflection.trace.parity ^= 1)
  const sides = front ? BOTH : OPAQUE
  resetHeads(encoder, reflection, sides)
  const classifier =
    closures && reflection.closureSides?.sides.length
      ? closureClassifyKernels(reflection.device, stages.group)
      : undefined
  const past = closuresTraced(encoder, reflection, groups.closures, closures, classifier)
  if (lit && traced) {
    litScratch.length = 0
    for (const at of past) litScratch.push(litSideOf(reflection.closureSides!.sides[at]!, inputs))
    resetHitLighting(encoder, reflection, sides, grid, lit.vertices, litScratch)
  }
  for (const { label, kernels } of PASSES) {
    // The hit lighting pass exists only for an image that lights hits again.
    if (label === REFLECTION_HIT_LIGHTING_PASS && !(lit && traced && inputs.rays)) continue
    const pass = encoder.beginComputePass({ label })
    // The depth pyramid's group, every kernel's: set once, kept across their pipelines.
    pass.setBindGroup(REFLECTION_GROUP, depthGroup)
    for (const side of sides) {
      const grids = side === 'opaque' ? reflection.grids : reflection.front.grids
      if (label === REFLECTION_TRACE_PASS) {
        pass.setPipeline(stages.classify)
        pass.setBindGroup(0, groups[side].classify[parity])
        const [x, y] = classifyGroups(size, side === 'opaque' ? block : frontBlock, classifying)
        pass.dispatchWorkgroups(x, y)
      }
      if (label === REFLECTION_HIT_LIGHTING_PASS && lit && traced && inputs.rays)
        encodeHitLighting(
          pass,
          lit,
          reflection,
          inputs,
          inputs.rays,
          side,
          traced.groups,
          grid,
          depthGroup,
        )
      for (const kernel of kernels) {
        if (kernel === 'clearTracing' && !readsNeighbours(side, block, frontBlock, reconstruct))
          continue
        if (kernel === 'screen' && side === 'opaque') cache?.limits(pass, grids.tracing)
        if (kernel === 'scene' && side === 'opaque' && meshes)
          dispatchReflectionMeshes(pass, groups.opaque, parity, meshes, reflection.grids)
        if (kernel === 'scene' && traced) {
          dispatchHardwareScene(
            pass,
            traced,
            side === 'opaque' ? 0 : 1,
            traced.groups.hits[side],
            traced.groups[side],
            grids[LISTS[kernel]],
          )
          continue
        }
        pass.setPipeline(stages[side][kernel])
        pass.setBindGroup(0, groups[side][kernel][parity])
        pass.dispatchWorkgroupsIndirect(grids[LISTS[kernel]], 0)
      }
      // The rays that met nothing within the distance the cache shortened them to, given the cache's light (`../radianceCache/wgsl.ts`).
      if (label === REFLECTION_SCENE_PASS && side === 'opaque') cache?.reads(pass, grids.tracing)
    }
    for (const at of past) {
      const side = reflection.closureSides!.sides[at]!
      const own = groups.closures[at]!
      const { grids } = side
      if (label === REFLECTION_TRACE_PASS) {
        // The tiles of the closure's overflow tiles alone: their tracing tiles marked, listed, and classified (`closureClassify.ts`).
        const tiled = closureClassifyGroups(
          reflection.device,
          classifier!.layouts,
          side,
          inputs.closureNormals![side.closure - 1]!,
          side.lobesView,
          closures!.tiles!,
        )
        pass.setPipeline(classifier!.mark)
        pass.setBindGroup(0, tiled.mark)
        pass.dispatchWorkgroupsIndirect(closures!.tiles!.args, closureArgsAt(side.closure))
        pass.setPipeline(classifier!.list)
        pass.setBindGroup(0, tiled.list)
        pass.dispatchWorkgroups(listGroups(grid))
        pass.setPipeline(classifier!.classify)
        pass.setBindGroup(0, tiled.classify)
        pass.dispatchWorkgroupsIndirect(side.marked, 0)
      }
      if (label === REFLECTION_HIT_LIGHTING_PASS && lit && traced && inputs.rays)
        encodeHitLighting(
          pass,
          lit,
          reflection,
          inputs,
          inputs.rays,
          litSideOf(side, inputs),
          traced.groups,
          grid,
          depthGroup,
        )
      // The scene path of the closure is the opaque surface's: the meshes' fields stage, the radiance cache's limits and reads, the triangles' trace.
      for (const kernel of kernels) {
        if (kernel === 'clearTracing' && !readsNeighbours('opaque', block, frontBlock, reconstruct))
          continue
        if (kernel === 'screen') cache?.limits(pass, grids.tracing)
        if (kernel === 'scene' && meshes) {
          const listed = reflectionMeshLists(stages.layouts, reflection.device, grids.meshRays!)
          if (listed) dispatchReflectionMeshes(pass, own, parity, meshes, grids, listed)
        }
        if (kernel === 'scene' && traced) {
          const answer = traced.groups.closures[at]
          if (answer)
            dispatchHardwareScene(
              pass,
              traced,
              0,
              answer.hits,
              answer.surface,
              grids[LISTS[kernel]],
            )
          continue
        }
        pass.setPipeline(stages.opaque[kernel])
        pass.setBindGroup(0, own[kernel][parity])
        pass.dispatchWorkgroupsIndirect(grids[LISTS[kernel]], 0)
      }
      if (label === REFLECTION_SCENE_PASS) cache?.reads(pass, grids.tracing)
    }
    // The opaque depth of this image, kept after every kernel that reads the last image's, for the next image's hits.
    if (label === REFLECTION_KEEP_DEPTH_PASS) {
      pass.setPipeline(stages.keepDepth)
      pass.setBindGroup(0, groups.keepDepth)
      pass.dispatchWorkgroups(ceilDiv(size[0], REFLECTION_SIDE), ceilDiv(size[1], REFLECTION_SIDE))
    }
    pass.end()
  }
  // A closure whose layers no trace wrote yet reads the first closure's, which the trace just wrote; one traced has its own from then on. Where no surface has the closure (`closures` none) no pixel reads its layers: nothing is copied.
  const closureSides = closures ? reflection.closureSides?.sides : undefined
  for (let at = 0; closureSides && at < closureSides.length; at++) {
    const side = closureSides[at]!
    if (past.includes(at)) side.written = true
    else if (!side.written) side.copyFirst(encoder)
  }
}
