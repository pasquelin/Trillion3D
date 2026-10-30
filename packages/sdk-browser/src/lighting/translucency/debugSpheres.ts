import { matrixAtRenderOrigin } from '../../../../math/src/projection/renderOrigin.ts'
import { readSetting } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { TRANSLUCENCY_VOLUME_RULES } from '../../../../sdk-core/src/contracts/translucencyVolumeOptions.ts'
import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { TRANSLUCENCY_VOLUME_SPHERES_PASS } from '../../diagnostic/stage/passLabels.ts'
import { createCachedGroup } from '../../gpu/bind/cachedGroup.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { taaRenderMatrix } from '../../post/taa/frame.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { COLOUR_ONLY } from '../../materials/surface/materialBlending.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { chainReady } from '../deferred/fullscreen.ts'
import { askSpheresPipeline, beginSpheresPass } from '../debugSpheres.ts'
import { uniformBlock, type UniformBlock } from '../../gpu/core/uniformBlock.ts'
import { DEBUG_CUBE_VERTICES, TV_DEBUG_VISUALIZE_WGSL } from './debugWgsl.ts'
import type { PublishedVolume } from './gpu.ts'
import { TRANSLUCENCY_CASCADES } from './layout.ts'

/** The words of a sphere draw's uniform (`TV_DEBUG_VISUALIZE_WGSL`'s `Viewer`): the view-projection, the radius, the cascade and the cells a side, padded to a vector. */
const VIEWER_WORDS = 20

/** The spheres' pipeline, once a device and compiled off the frame. */
const spheresPipeline = oncePerDevice((device: GPUDevice) =>
  askSpheresPipeline(device, {
    label: TRANSLUCENCY_VOLUME_SPHERES_PASS,
    module: device.createShaderModule({
      label: TRANSLUCENCY_VOLUME_SPHERES_PASS,
      code: TV_DEBUG_VISUALIZE_WGSL,
    }),
    vertex: 'tvVisualizeVs',
    fragment: 'tvVisualizeFs',
    layout: 'auto',
    targets: [{ format: HDR_FORMAT, writeMask: COLOUR_ONLY }],
  }),
)

/** What the spheres hold of a runtime: one buffer holding every cascade's viewer block, each at an aligned offset, what it holds, and a cached bind group a cascade. */
interface SpheresState {
  readonly viewers: UniformBlock
  /** The words between two cascades' blocks. */
  readonly stride: number
  /** The bind group of each cascade, kept for the volume's frame and texture it names: two volumes take turns (`published.view` alternates), each holds its group. */
  readonly groups: ReturnType<typeof createCachedGroup>[]
  layout?: GPUBindGroupLayout
}
const states = new WeakMap<WebgpuPagesRuntime, SpheresState>()
const RENDER_MATRIX = new Float64Array(16)

/** Gives the spheres' buffer back. */
export function disposeTranslucencyVolumeSpheres(rt: WebgpuPagesRuntime) {
  states.get(rt)?.viewers.buffer.destroy()
  states.delete(rt)
}

function newState(device: GPUDevice): SpheresState {
  const stride = device.limits.minUniformBufferOffsetAlignment / 4
  const viewers = uniformBlock(
    device,
    `${TRANSLUCENCY_VOLUME_SPHERES_PASS} viewers`,
    stride * TRANSLUCENCY_CASCADES * 4,
  )
  return {
    viewers,
    stride,
    groups: Array.from({ length: TRANSLUCENCY_CASCADES }, () => createCachedGroup(2)),
  }
}

/**
 * THE SPHERES OF THE TRANSLUCENCY LIGHTING VOLUME (`translucencyVolumeVisualize`, `translucencyVolumeVisualizeRadiusScale`,
 * `translucencyVolumeVisualizeCascadeIndex`): the sphere of every cell of the cascades asked for, lit by the volume the surfaces read, drawn
 * into the lit image once the transparents, the heterogeneous volumes and the clouds are on it, just before the resolve and before the tone mapping, with the scene's
 * depth tested and written. Nothing is drawn, and nothing is held, while it is not asked or the volume is not made this image.
 */
export function encodeTranslucencyVolumeSpheres(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  if (!readSetting(TRANSLUCENCY_VOLUME_RULES, rt.context, 'translucencyVolumeVisualize'))
    return disposeTranslucencyVolumeSpheres(rt)
  const published = gpu.translucencyVolume?.gpu?.published
  // The volume is not made this image (its pipelines compile, a cascade holds nothing): the view waits.
  if (!published?.view || !gpu.hdrView || !gpu.depthView) return
  const pipeline = spheresPipeline(device)
  if (!chainReady(pipeline)) return
  let state = states.get(rt)
  if (!state) states.set(rt, (state = newState(device)))
  draw(rt, device, encoder, pipeline.get()!, state, published, cam)
}

function draw(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipeline: GPURenderPipeline,
  state: SpheresState,
  published: PublishedVolume,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const only = readSetting(
    TRANSLUCENCY_VOLUME_RULES,
    rt.context,
    'translucencyVolumeVisualizeCascadeIndex',
  )
  const radiusScale =
    readSetting(TRANSLUCENCY_VOLUME_RULES, rt.context, 'translucencyVolumeVisualizeRadiusScale') /
    CENTIMETRES_PER_METRE
  const { dim } = published
  // The matrix the opaque surfaces were drawn with (jittered while the image accumulates), at the eye: the depth written here lands on theirs.
  matrixAtRenderOrigin(RENDER_MATRIX, taaRenderMatrix(rt, cam), cam.eye)
  // One write of every cascade's block, where the view changed: a still camera writes nothing.
  const { f: staged, u: stagedWords } = state.viewers.words
  staged.fill(0)
  for (let cascade = 0; cascade < TRANSLUCENCY_CASCADES; cascade++) {
    const at = cascade * state.stride
    staged.set(RENDER_MATRIX, at)
    staged[at + 16] = radiusScale * (cascade + 1)
    stagedWords[at + 17] = cascade
    stagedWords[at + 18] = dim
  }
  state.viewers.send()
  state.layout ??= pipeline.getBindGroupLayout(0)
  // One pass, a draw a cascade asked for.
  const pass = beginSpheresPass(
    encoder,
    TRANSLUCENCY_VOLUME_SPHERES_PASS,
    [gpu.hdrView!],
    gpu.depthView!,
  )
  pass.setPipeline(pipeline)
  for (let cascade = 0; cascade < TRANSLUCENCY_CASCADES; cascade++) {
    if (only !== -1 && only !== cascade) continue
    const group = state.groups[cascade]!(
      device,
      state.layout,
      [published.frame, state.viewers.buffer, published.view],
      () =>
        sequentialEntries([
          { buffer: published.frame },
          {
            buffer: state.viewers.buffer,
            offset: cascade * state.stride * 4,
            size: VIEWER_WORDS * 4,
          },
          published.view!,
        ]),
    )
    pass.setBindGroup(0, group)
    pass.draw(DEBUG_CUBE_VERTICES, dim ** 3)
  }
  pass.end()
}
