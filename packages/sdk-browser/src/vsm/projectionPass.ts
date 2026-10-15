/**
 * Host side of the projection (`projectionWgsl.ts`): its inputs, its groups and the dispatch into
 * the engine's mask; the view uniform is written by `projectionViewWrite.ts`, the pipelines are
 * `projectionPipelines.ts`'s, what a set holds `projectionStore.ts`'s.
 *
 * CONVENTIONS. This engine's view space looks down −Z (right-handed); the projection's looks down
 * +Z: its view matrices are ours with view Z negated (shiftedToView = flipZ · view ·
 * T(originShift), viewToClip = projection · flipZ); shiftedToClip is unchanged. Depth is
 * reverse-Z in both. Shifted = world + originShift (default −camera position), the
 * same split double the projection data carries.
 */
import { namedEntries, sequentialEntries } from '../gpu/core/computeBindings.ts'
import { hizDepthBindEntries } from '../gpu/hiz/pyramidTexture.ts'
import type { HizDepth } from '../gpu/hiz/types.ts'
import { VSM_PROJECTION_MAX_PASS_LIGHTS } from './projectionView.ts'
import {
  VSM_PROJECTION_BINDING,
  VSM_PROJECTION_RECEIVER_GROUP,
  vsmProjectionGroups,
} from './projectionWgsl.ts'
import { vsmPerFrameSet, type VsmResources } from './resources.ts'
import {
  VSM_PROJECTION_PASS,
  pipelineOfLights,
  pipelinesFor,
  tablesGroup,
  type Pipelines,
} from './projectionPipelines.ts'
import { vsmProjectionReserve, type VsmProjectionState } from './projectionStore.ts'
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

export interface VsmProjectionInputs {
  device: GPUDevice
  /** Scene depth (depth32float, reverse-Z), normals (`normalRough`, xyz = world normal) and the
   *  surface flags of the visibility buffer, all `width` × `height`. */
  depth: GPUTextureView
  normalRough: GPUTextureView
  flags: GPUTextureView
  /** The depth pyramid of the image (`GpuHiz.depth`, its nearest layer built): the screen ray
   *  marches it (`gpu/hiz/screenMarch.ts`). */
  hizDepth: HizDepth
  width: number
  height: number
  camera: VsmProjectionCamera
  /** The state frame index: drives the blue noise in time. */
  frameIndex: number
  /** The engine's mask (`vsmEncode.ts`): its 2-D array (`VSM_PROJECTION_MASK_FORMAT`, a layer per
   *  four lights at least) and its tile words (`VSM_PROJECTION_TILE_FORMAT`, a texel per group at
   *  least), both storage bindings, the size of the textures the view is drawn in (dynamic
   *  resolution draws below it, in their top-left) and its eighth. */
  mask: GPUTextureView
  maskTiles: GPUTextureView
  /** The engine's shadow receiver target, the resolve's (`receiverTargetWgsl.ts`): each pixel is
   *  projected from its point on the surface its vertex normals describe. */
  receiver: GPUTextureView
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

type VsmProjectionLightType = VsmProjectionLight['type']
/** The pass group of `state` over the frame's inputs: made again only when the layout or one of
 *  the views it binds moved (`createWebgpuBindIdentity`). */
function passGroupFor(
  device: GPUDevice,
  state: VsmProjectionState,
  p: Pipelines,
  inputs: VsmProjectionInputs,
) {
  const { next } = state.pass
  next[0] = p.passLayout
  next[1] = inputs.depth
  next[2] = inputs.hizDepth
  next[3] = inputs.normalRough
  next[4] = inputs.flags
  next[5] = inputs.mask
  next[6] = inputs.maskTiles
  if (state.pass.moved())
    state.passGroup = device.createBindGroup({
      label: 'vsm.projection.pass',
      layout: p.passLayout,
      entries: [
        ...namedEntries(VSM_PROJECTION_BINDING, {
          view: { buffer: state.uniform! },
          sceneDepth: inputs.depth,
          normalRough: inputs.normalRough,
          flags: inputs.flags,
          blueNoise: state.blueNoiseView!,
        }),
        ...hizDepthBindEntries(VSM_PROJECTION_BINDING.hizDepth, inputs.hizDepth),
        ...namedEntries(VSM_PROJECTION_BINDING, {
          shadowMask: inputs.mask,
          shadowMaskTiles: inputs.maskTiles,
        }),
      ],
    })
  return state.passGroup!
}

/** The receiver group of `state` over `receiver` on `layout`, made again when one of them moved. */
function receiverGroupFor(
  device: GPUDevice,
  state: VsmProjectionState,
  layout: GPUBindGroupLayout,
  receiver: GPUTextureView,
) {
  const { next } = state.receiver
  next[0] = layout
  next[1] = receiver
  if (state.receiver.moved())
    state.receiverGroup = device.createBindGroup({
      label: 'vsm.projection.receiver',
      layout,
      entries: sequentialEntries([receiver]),
    })
  return state.receiverGroup!
}

/**
 * Projects up to 64 lights in one dispatch into the engine's mask (`inputs.mask`, r32uint, a layer
 * per four lights): lane k % 4 of layer k / 4 is the shadow factor of `lights[k]` as its trace
 * counted it (`vsmMaskCode`), stored only in the 8×8 tiles whose words (`inputs.maskTiles`) hold a
 * light of that layer. Reads `res.current` (page table, projection data, uniforms) and the pool;
 * call after the frame's VSM render and before `res.swapFrames()`. Once a frame: the call writes
 * the set's one view uniform, which a second call in the same frame would overwrite.
 */
export function encodeVirtualShadowProjection(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  inputs: VsmProjectionInputs,
  lights: readonly VsmProjectionLight[],
) {
  if (lights.length > VSM_PROJECTION_MAX_PASS_LIGHTS)
    throw new Error(`VSM projection: at most ${VSM_PROJECTION_MAX_PASS_LIGHTS} lights per pass`)
  const { device, width, height } = inputs
  const state = vsmProjectionReserve(device, res)
  const p = pipelinesFor(device, res.layout)

  const bytes = writeVsmProjectionView(state.words, inputs, lights)
  device.queue.writeBuffer(state.uniform!, 0, state.staging, 0, bytes)

  const vsmGroup = vsmPerFrameSet(state.tables, res, tablesGroup, p, p.vsmLayout)
  const passGroup = passGroupFor(device, state, p, inputs)
  const pass = encoder.beginComputePass({ label: VSM_PROJECTION_PASS })
  pass.setPipeline(pipelineOfLights(p, lights))
  pass.setBindGroup(0, vsmGroup)
  pass.setBindGroup(1, passGroup)
  pass.setBindGroup(
    VSM_PROJECTION_RECEIVER_GROUP,
    receiverGroupFor(device, state, p.receiverLayout, inputs.receiver),
  )
  pass.dispatchWorkgroups(vsmProjectionGroups(width), vsmProjectionGroups(height), 1)
  pass.end()
}
