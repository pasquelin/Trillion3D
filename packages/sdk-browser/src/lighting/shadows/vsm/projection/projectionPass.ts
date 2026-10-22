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
import { namedEntries, sequentialEntries } from '../../../../gpu/core/computeBindings.ts'
import { hizDepthBindEntries } from '../../../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../../../visibility/hiz/gpu/types.ts'
import { VSM_PROJECTION_MAX_PASS_LIGHTS, type VsmTraceCounts } from './projectionView.ts'
import {
  VSM_PROJECTION_BINDING,
  VSM_PROJECTION_RECEIVER_GROUP,
  vsmProjectionGroups,
} from './projectionWgsl.ts'
import { vsmPerFrameSet, type VsmResources } from '../resources.ts'
import {
  VSM_PROJECTION_PASS,
  pipelineOfLights,
  pipelinesFor,
  tablesGroup,
} from './projectionPipelines.ts'
import {
  vsmProjectionReserve,
  vsmProjectionStandIns,
  type VsmProjectionState,
} from './projectionStore.ts'
import { writeVsmProjectionView } from './projectionViewWrite.ts'

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
  /** The lights the passes project, a mask channel each (≤ `VSM_PROJECTION_MAX_PASS_LIGHTS`). */
  lights: readonly VsmProjectionLight[]
}

/** The opaque surfaces a pass projects: their depth (depth32float, reverse-Z) and normals
 *  (`normalRough`, xyz = world normal), the opaque resolve's surface flags with the engine's shadow
 *  receiver target
 *  (`receiverTargetWgsl.ts`), each pixel projected from its point on the surface its vertex normals
 *  describe. */
export type VsmProjectionSource = {
  depth: GPUTextureView
  normalRough: GPUTextureView
  flags: GPUTextureView
  receiver: GPUTextureView
  /** The translucent casters' memory (`VsmTransmission.view`), none without them. */
  transmission?: GPUTextureView
}

/** Where a pass stores: a mask's
 *  2-D array (`VSM_PROJECTION_MASK_FORMAT`, a layer per four lights at least) and its tile words
 *  (`VSM_PROJECTION_TILE_FORMAT`, a texel per group at least), both storage bindings, the size of
 *  the targets (`vsmMask.ts`'s `VsmMask`). */
export interface VsmProjectionTarget {
  view: GPUTextureView
  tilesView: GPUTextureView
  /** What the panes let through along each light's missed rays, a layer a light
   *  (`VSM_PROJECTION_THROUGH_FORMAT`): made only with translucent casters. */
  throughView?: GPUTextureView
}

/** What every light of the pass holds. */
interface VsmProjectionLightCommon {
  /** The light's VSM id: first clipmap level (directional), the map (spot) or face 0 (point, rect). */
  mapId: number
  /** Direction the light travels (directional), the cone axis (spot), the emitting face normal
   *  (rect). Unit vector, world. Turned into the direction towards the light. */
  direction: ArrayLike<number>
  /** The source's size: its radius in metres for a local light, the sine of its angular radius
   *  for a directional one; absent, a point source. */
  sourceRadius?: number
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
        /** The cone's half-angle (radians), `SceneLight.coneAngle`. */
        coneAngle: number
      } & VsmProjectionReach)
  )

/** Whether the translucent casters' memory and the target their transmission is stored in are
 *  both bound: never without translucent casters. */
const panesBound = (source: VsmProjectionSource, target: VsmProjectionTarget) =>
  !!source.transmission && !!target.throughView

/** The pass group of `state` over `source`, `target` and the frame's depth pyramid: made again
 *  only when the layout or one of the resources it binds moved (`createWebgpuBindIdentity`). */
function passGroupFor(
  device: GPUDevice,
  state: VsmProjectionState,
  passLayout: GPUBindGroupLayout,
  hizDepth: HizDepth,
  source: VsmProjectionSource,
  target: VsmProjectionTarget,
) {
  const held = state.pass
  const standIns = panesBound(source, target) ? undefined : vsmProjectionStandIns(device, state)
  const transmission = standIns?.transmission ?? source.transmission!,
    through = standIns?.through ?? target.throughView!
  const { next } = held.identity
  next[0] = passLayout
  next[1] = source.depth
  next[2] = hizDepth
  next[3] = source.normalRough
  next[4] = source.flags
  next[5] = target.view
  next[6] = target.tilesView
  next[7] = transmission
  next[8] = through
  if (held.identity.moved())
    held.group = device.createBindGroup({
      label: 'vsm.projection.pass',
      layout: passLayout,
      entries: [
        ...namedEntries(VSM_PROJECTION_BINDING, {
          view: { buffer: state.uniform! },
          sceneDepth: source.depth,
          normalRough: source.normalRough,
          flags: source.flags,
          blueNoise: state.blueNoiseView!,
          shadowMask: target.view,
          shadowMaskTiles: target.tilesView,
          transmission,
          shadowThrough: through,
        }),
        ...hizDepthBindEntries(VSM_PROJECTION_BINDING.hizDepth, hizDepth),
      ],
    })
  return held.group!
}

/** The receiver group of `state` over `receiver` on `layout`, made again when one of them moved. */
function receiverGroupFor(
  device: GPUDevice,
  state: VsmProjectionState,
  layout: GPUBindGroupLayout,
  receiver: GPUTextureView,
) {
  const held = state.receiver
  const { next } = held.identity
  next[0] = layout
  next[1] = receiver
  if (held.identity.moved())
    held.group = device.createBindGroup({
      label: 'vsm.projection.receiver',
      layout,
      entries: sequentialEntries([receiver]),
    })
  return held.group!
}

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
}

/**
 * Projects the frame's lights (`writeVsmProjectionFrame`, written before) in one dispatch into
 * `target` (r32uint, a layer per four lights): lane k % 4 of layer k / 4 is the shadow factor of
 * light k as its trace counted it (`vsmMaskCode`), stored only in the 8×8 tiles whose words hold a
 * light of that layer, the opaque surfaces over the whole view. Reads `res.current` (page table, projection
 * data, uniforms) and the pool; call after the frame's VSM render and before `res.swapFrames()`.
 */
export function encodeVirtualShadowProjection(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  frame: VsmProjectionFrame,
  source: VsmProjectionSource,
  target: VsmProjectionTarget,
) {
  const { device, width, height, lights } = frame
  const state = vsmProjectionReserve(device, res)
  const p = pipelinesFor(device, res.layout)
  const vsmGroup = vsmPerFrameSet(state.tables, res, tablesGroup, p, p.vsmLayout)
  const passGroup = passGroupFor(device, state, p.passLayout, frame.hizDepth, source, target)
  const pass = encoder.beginComputePass({ label: VSM_PROJECTION_PASS })
  // Without translucent casters bound, the pipeline whose panes' gate and walk fold away.
  const transmits = panesBound(source, target)
  pass.setPipeline(pipelineOfLights(p, lights, transmits))
  pass.setBindGroup(0, vsmGroup)
  pass.setBindGroup(1, passGroup)
  pass.setBindGroup(
    VSM_PROJECTION_RECEIVER_GROUP,
    receiverGroupFor(device, state, p.receiverLayout, source.receiver),
  )
  pass.dispatchWorkgroups(vsmProjectionGroups(width), vsmProjectionGroups(height), 1)
  pass.end()
}
