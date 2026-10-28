import type { TranslucentMarkSettings } from '../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { createWebgpuBindIdentity } from '../gpu/bind/bindIdentity.ts'
import { sizedImage } from '../post/filters/sizedImage.ts'
import { hizDepthBindEntries } from '../visibility/hiz/gpu/pyramidTexture.ts'
import {
  createTranslucentMarkParams,
  TRANSLUCENT_MARK_BINDINGS as B,
  TRANSLUCENT_MARK_PARAMS_BYTES,
  translucentMarkTarget,
} from '../lighting/bounce/pool/translucentMark.ts'
import type { HizDepth } from '../visibility/hiz/gpu/types.ts'
import { RADIANCE_MARK_PASS } from '../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { drawBlendRuns } from './draw.ts'
import { blendEntries } from './identity.ts'
import { RADIANCE_MARK_DEPTH_BINDING, RADIANCE_MARK_GROUP } from './radianceMarkWgsl.ts'
import {
  radianceMarkBlendLayout,
  radianceMarkLayout,
  readByRadianceMark,
  RADIANCE_MARK_TARGET_FORMAT,
} from './radianceMarkStage.ts'

/** What the mark keeps for a runtime: the parameters' buffer and its writer, the dummy depth attachment the pass needs (`sizedImage`), and the
 *  groups it made with the identity of the resources each was made over, two of each as the depth pyramid alternates (`GpuHiz.swap`). */
function keep(device: GPUDevice) {
  const params = device.createBuffer({
    label: 'Trillion3D translucent radiance mark parameters',
    size: TRANSLUCENT_MARK_PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  return {
    device,
    params,
    write: createTranslucentMarkParams(device, params),
    target: sizedImage(
      device,
      'Trillion3D translucent radiance mark target',
      RADIANCE_MARK_TARGET_FORMAT,
      GPUTextureUsage.RENDER_ATTACHMENT,
    ),
    items: createWebgpuBindIdentity(2),
    itemGroups: [] as (GPUBindGroup | undefined)[],
    bound: createWebgpuBindIdentity(2),
    groups: [] as (GPUBindGroup | undefined)[],
  }
}
const kept = new WeakMap<WebgpuPagesRuntime, ReturnType<typeof keep>>()
const stateOf = (rt: WebgpuPagesRuntime, device: GPUDevice) => {
  let state = kept.get(rt)
  if (state?.device !== device) kept.set(rt, (state = keep(device)))
  return state
}

/** The first group: the items, the geometry and the atlases the stage reads of the blend group (`radianceMarkBlendLayout`), over the same
 *  resources, made again when one of them is not the one it was made over. It names no light, so it waits for none. */
function itemsGroup(rt: WebgpuPagesRuntime, device: GPUDevice, state: ReturnType<typeof keep>) {
  // The material records the item records named go up before a group names their texture.
  rt.vis.materialTable.viewFor(device)
  const { items } = state
  items.entries[0] ??= blendEntries(rt).filter(readByRadianceMark)
  const layout = radianceMarkBlendLayout(device)
  if (items.entriesMoved(layout)) state.itemGroups[items.slot] = undefined
  return (state.itemGroups[items.slot] ??= device.createBindGroup({
    label: 'Trillion3D translucent radiance mark items',
    layout,
    entries: items.entries[0],
  }))
}

/** The mark group over the levels' uniform `grid`, the bitmap `marks` and the depth `depth`, made again when one of them is not the one it was made over. */
function markGroup(
  device: GPUDevice,
  state: ReturnType<typeof keep>,
  grid: GPUBuffer,
  marks: GPUBuffer,
  depth: HizDepth,
) {
  const { bound } = state
  bound.next[0] = grid
  bound.next[1] = marks
  bound.next[2] = depth
  if (bound.moved()) state.groups[bound.slot] = undefined
  return (state.groups[bound.slot] ??= device.createBindGroup({
    label: 'Trillion3D translucent radiance mark',
    layout: radianceMarkLayout(device),
    entries: [
      { binding: B.params, resource: { buffer: state.params } },
      { binding: B.grid, resource: { buffer: grid } },
      { binding: B.marks, resource: { buffer: marks } },
      ...hizDepthBindEntries(RADIANCE_MARK_DEPTH_BINDING, depth),
    ],
  }))
}

/** The settings as the pass reads them: the depth test only over an opaque depth drawn this image, else the pyramid holds an image before's. */
const settingsOver = (settings: TranslucentMarkSettings, opaque: boolean) =>
  opaque || !settings.hizTest ? settings : { ...settings, hizTest: false }

/**
 * THE TRANSLUCENT SURFACES' MARK OF THE RADIANCE CACHE (`TranslucentMarker.mark`): the image's transparent runs drawn once more, in a pass
 * of their own the view's size divided by the settings' `downsample`, through the radiance mark stage (`radianceMarkWgsl.ts`), setting the bits of
 * the cells their fragments read in `marks`, with the levels' uniform `grid`. The transparents are prepared this image
 * (`radianceMarker`), and the pass comes before the pool's kernels; it draws them on a group of its own, which names no light. None without
 * runs, a depth pyramid or a compiled stage (asked, the mark skipped meanwhile). Without an opaque depth drawn this image the pyramid is
 * not tested. Returns the draws encoded.
 */
export function drawRadianceMark(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  grid: GPUBuffer,
  marks: GPUBuffer,
  settings: TranslucentMarkSettings,
) {
  const { gpu, vis, run, blendState } = rt
  if (!vis.blendPipelines || !blendState.runCount || !blendState.argsBuffer) return 0
  const depth = vis.gpuHiz?.depth()
  if (!depth) return 0
  const set = vis.blendPipelines.radianceMark
  if (!set.ready) {
    set.ask()
    return 0
  }
  const [width, height] = translucentMarkTarget(gpu.targetSize, settings.downsample)
  const state = stateOf(rt, device)
  state.write(settingsOver(settings, run.depthDrawn), gpu.targetSize)
  const pass = encoder.beginRenderPass({
    label: RADIANCE_MARK_PASS,
    colorAttachments: [],
    depthStencilAttachment: { view: state.target.view(width, height), depthReadOnly: true },
  })
  pass.setBindGroup(RADIANCE_MARK_GROUP, markGroup(device, state, grid, marks, depth))
  // No reflection read; any order (a mark is a bit set, the same whichever fragment sets it); no water.
  const encoded = drawBlendRuns(rt, device, pass, set, {
    reflected: false,
    group: itemsGroup(rt, device, state),
  })
  pass.end()
  run.gpuDrawCalls += encoded
  return encoded
}
