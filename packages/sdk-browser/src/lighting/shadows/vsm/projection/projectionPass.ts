/**
 * Host side of the projection (`projectionWgsl.ts`): the frame's context, written once into the
 * view uniform (`projectionViewWrite.ts`), and each pass's groups and dispatch into its target
 * mask; the pipelines are `projectionPipelines.ts`'s, what a set holds `projectionStore.ts`'s.
 *
 * CONVENTIONS. This engine's view space looks down −Z (right-handed); the projection's looks down
 * +Z: its view matrices are ours with view Z negated (shiftedToView = flipZ · view ·
 * T(originShift), viewToClip = projection · flipZ); shiftedToClip is unchanged. Depth is
 * reverse-Z in both. Shifted = world + originShift (default −camera position), the
 * same split double the projection data carries.
 */
import { chainReady } from '../../../deferred/fullscreen.ts'
import type { ComputeRun } from '../../../../gpu/core/lazyComputePass.ts'
import { namedEntries } from '../../../../gpu/core/computeBindings.ts'
import { hizDepthBindEntries } from '../../../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../../../visibility/hiz/gpu/types.ts'
import {
  sunCount,
  VSM_PROJECTION_CLASSIC_BYTES,
  VSM_PROJECTION_MAX_PASS_LIGHTS,
  VSM_PROJECTION_VIEW_WORD,
  type VsmTraceCounts,
} from './projectionView.ts'
import type { HairShadowSource } from '../../../../hair/viewGpu.ts'
import { VSM_PROJECTION_BINDING, vsmProjectionGroups } from './projectionWgsl.ts'
import { vsmPerFrameSet, type VsmResources } from '../resources.ts'
import type { ClassicSettings, ClassicSun } from '../../classic/classicView.ts'
import {
  VSM_PROJECTION_PASS,
  localsPipeline,
  sunsHairPass,
  pipelinesFor,
  sunsPipeline,
  tablesGroup,
} from './projectionPipelines.ts'
import type { onePassMaskFormat } from './maskFormat.ts'
import { vsmProjectionReserve, type VsmProjectionState } from './projectionStore.ts'
import type { HeldGroup } from '../../../../gpu/bind/bindIdentity.ts'
import { writeVsmProjectionView } from './projectionViewWrite.ts'
import { PER_LIGHT_RECORD_BINDING_BYTES } from './perLightRecord.ts'

/** The camera the pixels are reconstructed with. */
interface VsmProjectionCamera {
  /** World → view of this engine (column-major, −Z forward), e.g. `CameraFrame.view`. */
  view: ArrayLike<number>
  /** View → clip of this engine (reverse-Z, WebGPU depth range). */
  projection: ArrayLike<number>
  /** The camera's kind as the engine set it (`EngineCamera.perspective`), never read back from a
   *  matrix: an orthographic box of any size takes the orthographic path. */
  perspective: boolean
  /** The origin shift (double); default −camera position. Must be the one the
   *  projection data's `originShift` is relative to (the map view's). */
  originShift?: ArrayLike<number>
}

/** The frame's projection context: what every projection pass of a frame reads alike, written
 *  once a frame into the view uniform
 *  (`writeVsmProjectionFrame`). */
export interface VsmProjectionFrame {
  device: GPUDevice
  /** The depth pyramid of the image (`GpuHiz.depth`, its nearest layer built): the screen ray
   *  marches it (`visibility/hiz/gpu/screenMarch.ts`). */
  hizDepth: HizDepth
  /** The size the view is drawn at (the top-left of the targets under dynamic resolution). */
  width: number
  height: number
  camera: VsmProjectionCamera
  /** The state frame index: drives the blue noise in time. */
  frameIndex: number
  /** The view's rays and steps of a trace (`VsmProjectionView.traceRays`); absent, the defaults'. */
  trace?: VsmTraceCounts
  /** The classic shadows' words (`shadowVirtualEnable` off, `../../classic/classicView.ts`); absent, none. */
  classic?: { suns: readonly ClassicSun[]; nearCentimetres: number; settings: ClassicSettings }
  /** The lights the passes project, the suns first (≤ `VSM_PROJECTION_MAX_PASS_LIGHTS`). */
  lights: readonly VsmProjectionLight[]
}

/** The opaque surfaces a pass projects: their depth (depth32float, reverse-Z), normals
 *  (`normalRough`, xyz = world normal) and the opaque resolve's surface flags, each pixel projected
 *  from its reconstructed point, moved along its normal by the normal bias; and what the local lights'
 *  pass walks: the engine's deferred view, its lights and the light grid's lists. */
export type VsmProjectionSource = {
  depth: GPUTextureView
  normalRough: GPUTextureView
  flags: GPUTextureView
  /** The thin transmission's target, whose alpha is a subsurface receiver's opacity
   *  (`SurfaceBuffer.subsurfaceView`; a placeholder where no surface is thin). */
  subsurface: GPUTextureView
  /** The lobes target, whose coat factor marks a clear-coated receiver (`SurfaceBuffer.lobesView`; a
   *  placeholder where no surface carries a lobe). */
  lobes: GPUTextureView
  deferredView?: GPUBuffer
  directLights?: GPUBuffer
  tileLights?: GPUBuffer
  /** The light grid's view cells (columns × depth slices): none, no grid pruned (`lightGridWgsl.ts`). */
  gridCells?: number
}

/** Where the passes store (`vsmMask.ts`'s `VsmMask`): the suns' mask, a layer a sun
 *  (`VSM_SUN_MASK_FORMAT`), and the local lights' mask, a texel a pixel of `localFormat`
 *  (`maskFormat.ts`), both storage bindings, the size of the targets. */
export interface VsmProjectionTarget {
  suns: GPUTextureView
  /** The local lights' one-pass mask; none on the per-light path (`onePass` false). */
  locals?: GPUTextureView
  localFormat: ReturnType<typeof onePassMaskFormat>
  /** The shadowed lights' grid the marking pruned (`vsmLightGridFor`), which the local lights' pass and
   *  the lighting read. */
  lightGrid?: GPUBuffer
  /** The capsule shadows of the local lights: a layer a light of the frame (`VSM_PROJECTION_BINDING.capsule`); absent, none is read and the pass
   *  is the one without them. */
  capsule?: GPUTextureView
  /** The shadow the hair strands cast on the surfaces: a layer a light of the frame (`VSM_PROJECTION_BINDING.hairShadow`, `hair/surfaceShadowPass.ts`); absent, none is read and the passes
   *  are the ones without it (the `hair` cut). */
  hairShadow?: GPUTextureView
  /** False: the local lights' one-pass projection is left out (`shadowOnePassProjection`), each shadowed
   *  light being projected alone by the per-light path (`perLightPass.ts`); absent, it is made. */
  onePass?: boolean
}

/** What every light of the pass holds. */
interface VsmProjectionLightCommon {
  /** The light's VSM id: first clipmap level (directional), the map (spot) or face 0 (point, rect). */
  mapId: number
  /** A sun's: the id of the first level of its first-person clipmap, traced beside its own for the
   *  receivers that are not first-person ones (`shadowFirstPersonClipmap`); absent, it has none. */
  firstPersonMapId?: number
  /** Direction the light travels (directional), the cone axis (spot), the emitting face normal
   *  (rect). Unit vector, world. Turned into the direction towards the light. */
  direction: ArrayLike<number>
  /** The source's size: its radius in metres for a local light, the sine of its angular radius
   *  for a directional one; absent, a point source. */
  sourceRadius?: number
  /** The light's own factors on the depth bias and its slope of a classic shadow (`SceneLight.shadowBias`, `shadowSlopeBias`); absent, the defaults (0.5, 0.5). */
  shadowBias?: number
  shadowSlopeBias?: number
}

/** Where a local light stands and how far it reaches. */
interface VsmProjectionReach {
  /** World position (double). */
  position: ArrayLike<number>
  /** The light's range (m), the lighting's (`localLightReaches`): it lights nothing past it. */
  radius: number
}

/** One light of the pass (its shader parameters and its virtual shadow map id): a sun, which
 *  reaches every point; a point or a rectangle; a spot, which holds its cone. */
export type VsmProjectionLight = VsmProjectionLightCommon &
  (
    | { type: 'directional' }
    | ({ type: 'point' | 'rect' } & VsmProjectionReach)
    | ({
        type: 'spot'
        /** The outer cone's half-angle (radians) the lighting lights the spot by (`spotConesOf`). */
        coneAngle: number
      } & VsmProjectionReach)
  )

/** The optional resources a pass's group binds beyond the surfaces of its source. */
type PassGroupExtras = {
  capsule?: GPUTextureView
  hairShadow?: GPUTextureView
  lightGrid?: GPUBuffer
  filterableMerged?: GPUBuffer
  perLight?: GPUBuffer
  strands?: HairShadowSource
}

/** The resources a pass's group names, noted in the group's identity: the group is made again when one of them moved. */
function noteGroupInputs(
  held: HeldGroup,
  groupLayout: GPUBindGroupLayout,
  hizDepth: HizDepth,
  source: VsmProjectionSource,
  mask: GPUTextureView,
  { lightGrid, filterableMerged, perLight, strands, capsule, hairShadow }: PassGroupExtras,
) {
  const { next } = held.identity
  next[0] = groupLayout
  next[1] = source.depth
  next[2] = hizDepth
  next[3] = source.normalRough
  next[4] = source.flags
  next[5] = mask
  next[6] = source.subsurface
  next[7] = source.deferredView
  next[8] = source.directLights
  next[9] = source.tileLights
  next[10] = lightGrid
  next[11] = source.lobes
  next[12] = filterableMerged
  next[13] = perLight
  next[14] = strands?.hairDepth
  next[15] = strands?.counts
  next[16] = strands?.tiles
  next[17] = capsule
  next[18] = hairShadow
}

/** A pass's group over `source`, the frame's depth pyramid and the pass's own `bindings`: made again
 *  only when the layout or one of the resources it binds moved (`createWebgpuBindIdentity`). The locals'
 *  pass binds `lightGrid`, the suns' of a set with the prefiltered distant shadow `filterableMerged`, the
 *  per-light pass (`perLightPass.ts`) the records `perLight`. A pass over the hair strands (input
 *  `strands`) binds `strands` in the place of the surfaces of `source`, whose lights it walks. */
export function passGroupFor(
  device: GPUDevice,
  state: VsmProjectionState,
  held: HeldGroup,
  groupLayout: GPUBindGroupLayout,
  hizDepth: HizDepth,
  source: VsmProjectionSource,
  mask: GPUTextureView,
  { lightGrid, filterableMerged, perLight, strands, capsule, hairShadow }: PassGroupExtras = {},
) {
  const locals = !!lightGrid
  noteGroupInputs(held, groupLayout, hizDepth, source, mask, {
    lightGrid,
    filterableMerged,
    perLight,
    strands,
    capsule,
    hairShadow,
  })
  if (held.identity.moved())
    held.group = device.createBindGroup({
      label: locals
        ? 'vsm.projection.locals'
        : perLight
          ? 'vsm.projection.perLight'
          : 'vsm.projection.suns',
      layout: groupLayout,
      entries: strands
        ? strandsEntries(state, hizDepth, source, mask, strands, lightGrid, filterableMerged)
        : surfaceEntries(
            state,
            hizDepth,
            source,
            mask,
            lightGrid,
            filterableMerged,
            perLight,
            capsule,
            hairShadow,
          ),
    })
  return held.group!
}

/** The entries of a pass's group over the surfaces of `source` (`passGroupFor`). */
const surfaceEntries = (
  state: VsmProjectionState,
  hizDepth: HizDepth,
  source: VsmProjectionSource,
  mask: GPUTextureView,
  lightGrid: GPUBuffer | undefined,
  filterableMerged: GPUBuffer | undefined,
  perLight: GPUBuffer | undefined,
  capsule: GPUTextureView | undefined,
  hairShadow: GPUTextureView | undefined,
) => [
  ...namedEntries(VSM_PROJECTION_BINDING, {
    view: { buffer: state.uniform! },
    sceneDepth: source.depth,
    normalRough: source.normalRough,
    flags: source.flags,
    blueNoise: state.blueNoiseView!,
    mask,
    subsurface: source.subsurface,
    lobes: source.lobes,
    ...(lightGrid && {
      deferredView: { buffer: source.deferredView! },
      directLights: { buffer: source.directLights! },
      tileLights: { buffer: source.tileLights! },
      lightGrid: { buffer: lightGrid },
    }),
    ...(filterableMerged && { filterableMerged: { buffer: filterableMerged } }),
    ...(capsule && { capsule }),
    ...(hairShadow && { hairShadow }),
    ...(perLight && {
      perLight: { buffer: perLight, size: PER_LIGHT_RECORD_BINDING_BYTES },
    }),
  }),
  ...hizDepthBindEntries(VSM_PROJECTION_BINDING.hizDepth, hizDepth),
]

/** The entries of a pass's group over the hair strands `strands` (`passGroupFor`). */
const strandsEntries = (
  state: VsmProjectionState,
  hizDepth: HizDepth,
  source: VsmProjectionSource,
  mask: GPUTextureView,
  strands: HairShadowSource,
  lightGrid: GPUBuffer | undefined,
  filterableMerged: GPUBuffer | undefined,
) => [
  ...namedEntries(VSM_PROJECTION_BINDING, {
    view: { buffer: state.uniform! },
    sceneDepth: strands.hairDepth,
    blueNoise: state.blueNoiseView!,
    mask,
    strandsCounts: { buffer: strands.counts },
    strandsTiles: { buffer: strands.tiles },
    ...(lightGrid && {
      deferredView: { buffer: source.deferredView! },
      directLights: { buffer: source.directLights! },
      lightGrid: { buffer: lightGrid },
    }),
    ...(filterableMerged && { filterableMerged: { buffer: filterableMerged } }),
  }),
  ...hizDepthBindEntries(VSM_PROJECTION_BINDING.hizDepth, hizDepth),
]

/**
 * Writes the frame's projection context `frame` into the view uniform of `res` — the camera, the
 * phase, the size and the lights' records —, once a frame, before its passes
 * (`encodeVirtualShadowProjection`), which all read it; the blended surfaces' trace reads it too
 * (`vsmProjectionShared`).
 */
export function writeVsmProjectionFrame(res: VsmResources, frame: VsmProjectionFrame) {
  const { device, lights } = frame
  if (lights.length > VSM_PROJECTION_MAX_PASS_LIGHTS)
    throw new Error(`VSM projection: at most ${VSM_PROJECTION_MAX_PASS_LIGHTS} lights per pass`)
  const state = vsmProjectionReserve(device, res)
  const bytes = writeVsmProjectionView(state.words, frame, lights)
  device.queue.writeBuffer(state.uniform!, 0, state.staging, 0, bytes)
  // The classic shadows' words lie after the last light the view could hold: a second upload, none while the shadows are virtual.
  if (frame.classic) {
    const at = 4 * VSM_PROJECTION_VIEW_WORD.classic
    device.queue.writeBuffer(state.uniform!, at, state.staging, at, VSM_PROJECTION_CLASSIC_BYTES)
  }
}

const PROJECTION_PASS: GPUComputePassDescriptor = { label: VSM_PROJECTION_PASS }

/** Whether the frame's local lights take the one-pass projection, whatever the pixels: the frame holds a
 *  local light (the suns head the lights), its light grid was pruned and its one-pass mask is made
 *  (`target.onePass` not false: else each light is projected alone, `perLightPass.ts`). */
export const projectsLocals = (
  lights: readonly VsmProjectionLight[],
  source: VsmProjectionSource,
  target: VsmProjectionTarget,
) =>
  lights.length > 0 &&
  lights[lights.length - 1].type !== 'directional' &&
  !!source.deferredView &&
  !!source.directLights &&
  !!source.tileLights &&
  !!source.gridCells &&
  !!target.lightGrid &&
  !!target.locals &&
  target.onePass !== false

/** The suns' projection into `target.suns`, once its pipeline is compiled. */
function encodeSunsProjection(
  pass: GPUComputePassEncoder,
  stage: ReturnType<typeof sunsPipeline>,
  groupLayout: GPUBindGroupLayout,
  device: GPUDevice,
  state: VsmProjectionState,
  res: VsmResources,
  frame: VsmProjectionFrame,
  source: VsmProjectionSource,
  target: VsmProjectionTarget,
) {
  const compiled = stage.get()
  if (!compiled) return
  pass.setPipeline(compiled)
  pass.setBindGroup(
    1,
    passGroupFor(device, state, state.suns, groupLayout, frame.hizDepth, source, target.suns, {
      filterableMerged: res.filterable?.merged,
      hairShadow: target.hairShadow,
    }),
  )
  pass.dispatchWorkgroups(vsmProjectionGroups(frame.width), vsmProjectionGroups(frame.height), 1)
}

/**
 * Projects the frame's lights (`writeVsmProjectionFrame`, written before), the opaque surfaces over the
 * whole view, in two passes as the reference does: the suns into `target.suns` (a layer a sun, the
 * share of its shadow at each pixel) and the local lights, in one pass, into `target.locals` (the shares
 * of the lights of the pixel's cell, four bits a light, `maskFormat.ts`). A pass is made where the
 * frame holds a light of its kind; the local lights' over the shadowed lights' grid of `res`, which the
 * marking pruned (`lightGridWgsl.ts`) and the lighting reads too (`vsmShadowedLightGrid`). Reads
 * `res.current` (page table, projection data, uniforms) and the pool; call after the frame's VSM render and before `res.swapFrames()`.
 * False, and nothing encoded, while a pipeline it needs compiles.
 */
export function encodeVirtualShadowProjection(
  steps: ComputeRun,
  res: VsmResources,
  frame: VsmProjectionFrame,
  source: VsmProjectionSource,
  target: VsmProjectionTarget,
) {
  const { device, width, height, lights } = frame
  const state = vsmProjectionReserve(device, res)
  const p = pipelinesFor(device, res.layout)
  const vsmGroup = vsmPerFrameSet(state.tables, res, tablesGroup, p, p.vsmLayout)
  const suns = sunCount(lights) > 0
  const locals = projectsLocals(lights, source, target)
  // Both pipelines or neither: the caller keeps the projection as drawn once it ran.
  const hair = !!target.hairShadow
  const sunsHair = suns && hair ? sunsHairPass(p) : undefined
  const sunsStage = suns ? (sunsHair ? sunsHair.pipeline : sunsPipeline(p)) : undefined
  const mine = locals
    ? localsPipeline(p, target.localFormat, 'gbuffer', !!target.capsule, hair)
    : undefined
  if (!chainReady(sunsStage, mine?.pipeline)) return false
  const pass = steps.pass(PROJECTION_PASS)
  pass.setBindGroup(0, vsmGroup)
  if (sunsStage)
    encodeSunsProjection(
      pass,
      sunsStage,
      sunsHair?.groupLayout ?? p.sunsLayout,
      device,
      state,
      res,
      frame,
      source,
      target,
    )
  const compiled = mine?.pipeline.get()
  if (mine && compiled) {
    pass.setBindGroup(
      1,
      passGroupFor(
        device,
        state,
        state.locals,
        mine.groupLayout,
        frame.hizDepth,
        source,
        target.locals!,
        { lightGrid: target.lightGrid, capsule: target.capsule, hairShadow: target.hairShadow },
      ),
    )
    pass.setPipeline(compiled)
    pass.dispatchWorkgroups(vsmProjectionGroups(width), vsmProjectionGroups(height), 1)
  }
  return true
}
