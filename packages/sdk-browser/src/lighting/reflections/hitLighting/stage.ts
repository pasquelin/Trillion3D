import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { isPending, isReady, REFLECTION_HIT_GROUP } from '../../rays/sceneTrace/sceneMaskHold.ts'
import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { dagReadGroupEntries } from '../../../geometry/dag/shader/bindings.ts'
import { surfaceHitCardsEntries } from '../../surfaceCache/hitWgsl.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import {
  hitLightingRuns,
  type HitLightingSettings,
} from '../../../../../sdk-core/src/contracts/hitLightingOptions.ts'
import { rayFogBindEntries } from '../rayFog.ts'
import { litFits, reflectionHitWords, type ReflectionGrids } from '../grids.ts'
import {
  hardwareFinishLayout,
  hardwareFinishSceneLayout,
  hardwareLitLayout,
  REFLECTION_FOG_BINDINGS,
  REFLECTION_HARDWARE_SCENE,
  REFLECTION_INDIRECT_BINDINGS,
  REFLECTION_TRACE_BINDINGS as B,
} from '../trace/traceBindings.ts'
import type { TraceInputs, TraceResources } from '../trace/traceGroups.ts'
import { REFLECTION_GROUP } from '../viewLayout.ts'
import { hitLightingMaker, litCompactLayout, litListGroups } from './kernels.ts'
import { LIT_COMPACT_BINDINGS as C, LIT_PATH_HOST } from './litWgsl.ts'
import { lightProfileBindEntries } from '../../lightProfile/profileBindings.ts'
import {
  encodeLitList,
  litRunBinder,
  type LitListArgs,
  type LitListGroups,
  type LitListKernels,
} from './listPasses.ts'

/** The hit lighting of an image: its kernels, and whether the traces are sorted by material. The one run a view keeps (`hitLightingRun`), written over each image. */
export interface HitLightingRun {
  kernels: ReturnType<ReturnType<typeof hitLightingMaker>>
  bucket: boolean
  /** The vertices a path of the hit lighting holds at most (its reflection bounces over its refraction stretches). */
  vertices: number
  /** The reflection group of the first pass (`reflectionHitLayout`), which the second does not bind: the pass sets it, then the image's own (`depthGroup`). */
  group: GPUBindGroup
  /** The head of each surface's list of traces to light, emptied for an image on the commands of `encoder` (`resetHitLighting`). */
  reset(
    encoder: GPUCommandEncoder,
    reflection: TraceResources,
    sides: readonly ('opaque' | 'front')[],
    grid: readonly [number, number],
  ): void
  /** The hit lighting of a surface's traces in the open compute pass (`encodeHitLighting`); a call of the run, so that the reflections' encoding names none of this module's values. */
  encode(
    pass: GPUComputePassEncoder,
    reflection: TraceResources,
    inputs: TraceInputs,
    rays: SceneRays,
    side: 'opaque' | 'front',
    scene: { maskedScene: GPUBindGroup },
    grid: readonly [number, number],
    depthGroup: GPUBindGroup,
  ): void
}

/** The run each view keeps, written over each image: nothing is allocated an image. It is read by the encoding of the same image, before another view's. */
const runs = new WeakMap<TraceResources, HitLightingRun>()

/** What each device was last told the hit lighting does not fit it for (`hitLightingFits`): the grid's extent, the reflection bounces and the refraction events of the refusal. It is told again when that changes, and after the hit lighting has fitted. */
const refused = new WeakMap<
  GPUDevice,
  { width: number; height: number; bounces: number; refractions: number }
>()

/** Whether the hit lighting runs for an image of the grid `grid`: the settings ask for it and the buffers of the grid (`litFits`) fit one binding of the device. The option is refused, with a line in the console, where they do not: the reflections then keep the cache's light and the lit image, and the scene stage is made without the hit lighting's code and record word. */
export function hitLightingFits(
  device: GPUDevice,
  settings: HitLightingSettings,
  grid: readonly [number, number],
) {
  if (!hitLightingRuns(settings)) return false
  if (litFits(device, grid, settings.vertices)) {
    refused.delete(device)
    return true
  }
  const told = refused.get(device)
  if (
    told?.width !== grid[0] ||
    told.height !== grid[1] ||
    told.bounces !== settings.bounces ||
    told.refractions !== settings.refractions
  ) {
    refused.set(device, {
      width: grid[0],
      height: grid[1],
      bounces: settings.bounces,
      refractions: settings.refractions,
    })
    const bytes = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
    console.warn(
      `reflection hit lighting refused: a grid of ${grid[0]} x ${grid[1]} texels with ${settings.bounces} reflection bounce${settings.bounces === 1 ? '' : 's'} over ${settings.refractions + 1} refraction stretch${settings.refractions === 0 ? '' : 'es'} a path needs more than the ${bytes >> 20} MB a storage binding of this device holds (min of maxStorageBufferBindingSize and maxBufferSize); lower reflectionMaxBounces or reflectionMaxRefractionBounces, use a coarser reflection level or a smaller image`,
    )
  }
  return false
}

/** The hit lighting of this image where it runs (`hitLightingFits`: `group` is the reflection group of its first pass, given only then), the scene stage casts its rays through the scene's triangles (`rays`) and the kernels are compiled (they are asked of the device on the first image that wants them). */
export function hitLightingRun(
  reflection: TraceResources,
  settings: HitLightingSettings,
  rays: SceneRays | undefined,
  light: LightAtlasFormat,
  group: GPUBindGroup | undefined,
): HitLightingRun | undefined {
  if (!group || !rays) return undefined
  const kernels = rays.sceneTrace.maskHold.use(
    'hit lighting',
    light,
    hitLightingMaker(reflection.device, light),
    isReady,
    isPending,
    REFLECTION_HIT_GROUP,
  )?.kernel
  if (!kernels?.ready) return undefined
  const held = runs.get(reflection)
  if (!held) {
    const made: HitLightingRun = {
      kernels,
      bucket: settings.bucket,
      vertices: settings.vertices,
      group,
      reset: (encoder, reflection, sides, grid) =>
        resetHitLighting(encoder, reflection, sides, grid, made.vertices),
      encode: (pass, reflection, inputs, rays, side, scene, grid, depthGroup) =>
        encodeHitLighting(pass, made, reflection, inputs, rays, side, scene, grid, depthGroup),
    }
    runs.set(reflection, made)
    return made
  }
  held.kernels = kernels
  held.bucket = settings.bucket
  held.vertices = settings.vertices
  held.group = group
  return held
}

/** The bind groups of one surface's hit lighting, with what they were made over. */
interface LitGroups {
  readonly identity: ReturnType<typeof createWebgpuBindIdentity>
  /** The grid width last written to the parameters (`encodeHitLighting`). */
  width?: number
  groups?: LitListGroups
}
const held = new WeakMap<object, LitGroups>()
/** The run of each surface's list (`encodeLitList`), written over each image; it is used by the encoding of the same image. */
const binders = {
  opaque: litRunBinder<LitListKernels, LitListArgs>(REFLECTION_HARDWARE_SCENE.group),
  front: litRunBinder<LitListKernels, LitListArgs>(REFLECTION_HARDWARE_SCENE.group),
}
/** The parameters' words, written from when the grid's width changes. */
const PARAMS = new Uint32Array(4)

function groupsOf(
  reflection: TraceResources,
  inputs: TraceInputs,
  rays: SceneRays,
  light: LightAtlasFormat,
  own: ReflectionGrids,
  grid: readonly [number, number],
  vertices: number,
  pixels: { flags: GPUTextureView; normals: GPUTextureView; lobes: GPUTextureView },
  maskedScene: GPUBindGroup,
): LitListGroups {
  const { device } = reflection
  const lit = own.lit(grid, vertices)
  const state = held.get(lit) ?? { identity: createWebgpuBindIdentity() }
  held.set(lit, state)
  const { hit } = inputs
  const { views, sceneTrace } = rays
  const hits = own.hits(reflectionHitWords(true), grid)
  const { next } = state.identity
  next.length = 0
  // The layouts follow the device and the light's format: `light` names them.
  next.push(light, own.pending, hits, own.rays, own.fresh)
  next.push(
    pixels.flags,
    pixels.normals,
    pixels.lobes,
    inputs.lights,
    inputs.vectors,
    reflection.depthView,
    inputs.lightFunction,
    inputs.lightProfile.view,
    inputs.lightProfile.sampler,
  )
  next.push(
    inputs.fog.cubemap,
    inputs.fog.sampler,
    hit.tables,
    hit.depth,
    hit.indirect,
    hit.feedback,
    hit.instances,
  )
  next.push(views.nodes, views.frames, views.worlds, views.tree, sceneTrace.params)
  // The scene trace's group of the first pass follows the image (its masks), outside the groups kept.
  if (!state.identity.moved() && state.groups) {
    state.groups.scene = maskedScene
    return state.groups
  }
  const buffer = (b: GPUBuffer) => ({ buffer: b })
  const listed = (binding: number, resource: GPUBindingResource) => ({ binding, resource })
  const lists = [
    listed(B.litList, buffer(lit.list)),
    listed(B.litSorted, buffer(lit.sorted)),
    listed(B.litRadiance, buffer(lit.radiance)),
  ]
  const group = (layout: GPUBindGroupLayout, entries: GPUBindGroupEntry[]) =>
    device.createBindGroup({ layout, entries })
  const materials = lit.materials.createView()
  return (state.groups = {
    compact: group(litCompactLayout(device), [
      listed(C.params, buffer(lit.params)),
      listed(C.pending, buffer(own.pending)),
      listed(C.hits, buffer(hits)),
      listed(C.list, buffer(lit.list)),
      listed(C.materials, materials),
    ]),
    ...litListGroups(device, lit, materials),
    direct: group(hardwareLitLayout(device), [
      ...namedEntries(B, {
        flags: pixels.flags,
        normals: pixels.normals,
        lobes: pixels.lobes,
        rays: own.rays,
        lights: buffer(inputs.lights),
        hits: buffer(hits),
      }),
      ...dagReadGroupEntries(views),
      ...lists,
      listed(B.litFunction, inputs.lightFunction),
      ...lightProfileBindEntries(LIT_PATH_HOST.lightProfile, inputs.lightProfile),
    ]),
    scene: maskedScene,
    finish: group(hardwareFinishLayout(device, light), [
      ...namedEntries(B, {
        flags: pixels.flags,
        normals: pixels.normals,
        lobes: pixels.lobes,
        rays: own.rays,
        lights: buffer(inputs.lights),
        vectors: inputs.vectors,
        depthHistory: reflection.depthView,
        traceOut: own.fresh,
      }),
      ...surfaceHitCardsEntries(REFLECTION_INDIRECT_BINDINGS, hit),
      ...rayFogBindEntries(REFLECTION_FOG_BINDINGS, true, inputs.fog),
      listed(B.hits, buffer(hits)),
      ...lists,
    ]),
    finishScene: group(hardwareFinishSceneLayout(device), [
      listed(REFLECTION_HARDWARE_SCENE.first, buffer(sceneTrace.params)),
    ]),
  })
}

/** The head of each surface's list of traces to light, emptied for an image (the count is its first word), on the commands of `encoder`. */
export function resetHitLighting(
  encoder: GPUCommandEncoder,
  reflection: TraceResources,
  sides: readonly ('opaque' | 'front')[],
  grid: readonly [number, number],
  vertices: number,
) {
  for (const side of sides)
    encoder.clearBuffer(
      (side === 'opaque' ? reflection.grids : reflection.front.grids).lit(grid, vertices).list,
      0,
      4,
    )
}

/**
 * THE HIT LIGHTING OF A SURFACE'S TRACES in the open compute pass `pass` (the reflection group is set): the rays whose hit the scene stage marked (`REFLECTION_HIT_LIT`) are
 * collected from the list of the rays it answered (`litCompact`), sorted by the material of their hit (the sort, `sortWgsl.ts`; the list as it stands where the materials are not
 * bucketed), lit where they stand (`litDirect`: the hit's material, the lights and their shadow rays) and finished (`litFinish`: the cache's indirect light, the fog, the fresh grid).
 * The first pass binds the reflection group of `run.group` (without the lit image), the second the image's own, `depthGroup`. `maskedScene` is the scene trace's group (with its any-hit test) of the first pass; the second pass binds the trace's parameters alone. `grid` is the grid this image uses (`usedAxis`, `ReflectionView.grid`).
 */
export function encodeHitLighting(
  pass: GPUComputePassEncoder,
  run: HitLightingRun,
  reflection: TraceResources,
  inputs: TraceInputs,
  rays: SceneRays,
  side: 'opaque' | 'front',
  scene: { maskedScene: GPUBindGroup },
  grid: readonly [number, number],
  depthGroup: GPUBindGroup,
) {
  const opaque = side === 'opaque'
  const own = opaque ? reflection.grids : reflection.front.grids
  const pixels = opaque ? inputs : reflection.front.views
  const layer = opaque ? 0 : 1
  const lit = own.lit(grid, run.vertices)
  const groups = groupsOf(
    reflection,
    inputs,
    rays,
    run.kernels.light,
    own,
    grid,
    run.vertices,
    pixels,
    scene.maskedScene,
  )
  // The pitch of the hits' records is this image's grid width: written when it changes.
  const state = held.get(lit)!
  if (state.width !== grid[0]) {
    PARAMS[0] = grid[0]!
    reflection.device.queue.writeBuffer(lit.params, 0, PARAMS)
    state.width = grid[0]
  }
  const bound = binders[side](run.kernels.layer(layer), lit, groups, run.bucket)
  // The first pass binds the reflection group of the run (without the lit image), the second the image's own.
  const view = (bound.view ??= { index: REFLECTION_GROUP, direct: run.group, finish: depthGroup })
  view.direct = run.group
  view.finish = depthGroup
  encodeLitList(pass, bound, own.pending)
}
