import {
  translucentMarkSettings,
  type TranslucentMarkSettings,
} from '../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { standInBuffer, standInTexture } from '../gpu/core/standIns.ts'
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
import type { TranslucentMarker } from '../lighting/bounce/pool/pool.ts'
import { screenProbeSettingsOf } from '../lighting/bounce/screen/settingsOf.ts'
import { MARK_FORMAT, TRANSLUCENCY_FRAME_BYTES } from '../lighting/translucency/layout.ts'
import { drawBlendRuns } from './draw.ts'
import { blendEntries } from './identity.ts'
import {
  RADIANCE_MARK_DEPTH_BINDING,
  RADIANCE_MARK_GROUP,
  VOLUME_MARK_FRAME_BINDING,
  VOLUME_MARK_TEXTURE_BINDING,
} from './radianceMarkWgsl.ts'
import {
  radianceMarkBlendLayout,
  radianceMarkLayout,
  readByRadianceMark,
  RADIANCE_MARK_TARGET_FORMAT,
} from './radianceMarkStage.ts'

/** Where the surfaces of an image mark the cells of the translucency lighting volume (`TranslucencyVolumeGpu.prepare`): the volume's frame
 *  uniform and the marks' texture. */
export interface VolumeMarks {
  frame: GPUBuffer
  view: GPUTextureView
}

/** What the mark keeps for a runtime: the parameters' buffer and its writer, the dummy depth attachment the pass needs (`sizedImage`), the
 *  volume's marks of the image until the pass draws them (`holdVolumeMarks`) with the stand-ins the pass binds where it marks none, and the
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
    /** The volume's marks the image prepared, still to be drawn. */
    volume: undefined as VolumeMarks | undefined,
    /** The frame (zeros: the pass marks no cell of the volume) and the one-cell marks the pass binds where it marks none. */
    noVolume: {
      frame: standInBuffer(
        device,
        'Trillion3D translucent radiance mark no volume frame',
        TRANSLUCENCY_FRAME_BYTES,
        GPUBufferUsage.UNIFORM,
      ),
      view: standInTexture(
        device,
        'Trillion3D translucent radiance mark no volume marks',
        MARK_FORMAT,
        { dimension: '3d', storage: true },
      ).createView({ dimension: '3d' }),
    } satisfies VolumeMarks,
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

/** The mark group over the levels' uniform `grid`, the bitmap `marks`, the depth `depth` and the volume's marks `volume`, made again when one of them
 *  is not the one it was made over. */
function markGroup(
  device: GPUDevice,
  state: ReturnType<typeof keep>,
  grid: GPUBuffer,
  marks: GPUBuffer,
  depth: HizDepth,
  volume: VolumeMarks,
) {
  const { bound } = state
  bound.next[0] = grid
  bound.next[1] = marks
  bound.next[2] = depth
  bound.next[3] = volume.frame
  bound.next[4] = volume.view
  if (bound.moved()) state.groups[bound.slot] = undefined
  return (state.groups[bound.slot] ??= device.createBindGroup({
    label: 'Trillion3D translucent radiance mark',
    layout: radianceMarkLayout(device),
    entries: [
      { binding: B.params, resource: { buffer: state.params } },
      { binding: B.grid, resource: { buffer: grid } },
      { binding: B.marks, resource: { buffer: marks } },
      ...hizDepthBindEntries(RADIANCE_MARK_DEPTH_BINDING, depth),
      { binding: VOLUME_MARK_FRAME_BINDING, resource: { buffer: volume.frame } },
      { binding: VOLUME_MARK_TEXTURE_BINDING, resource: volume.view },
    ],
  }))
}

/** The settings as the pass reads them: the depth test only over an opaque depth drawn this image, else the pyramid holds an image before's. */
const settingsOver = (settings: TranslucentMarkSettings, opaque: boolean) =>
  opaque || !settings.hizTest ? settings : { ...settings, hizTest: false }

/** Whether the translucent surfaces' mark pass can be drawn this image: runs prepared, the argument buffer, a depth pyramid, the stage compiled
 *  (asked, and false, while it compiles). The volume is prepared for marks only then, or its cells would stay empty (it is made whole instead). */
export function markDrawable(rt: WebgpuPagesRuntime) {
  const { vis, blendState } = rt
  if (!vis.blendPipelines || !blendState.runCount || !blendState.argsBuffer) return undefined
  const depth = vis.gpuHiz?.depth()
  if (!depth) return undefined
  const set = vis.blendPipelines.radianceMark
  if (set.ready) return { depth, set }
  set.ask()
  return undefined
}

/**
 * THE TRANSLUCENT SURFACES' MARK (`TranslucentMarker.mark`): the image's transparent runs drawn once more, in a pass of their own the view's size
 * divided by the settings' `downsample`, through the radiance mark stage (`radianceMarkWgsl.ts`), setting the bits of the cells their fragments
 * read in `marks`, with the levels' uniform `grid`, and the cells of the translucency lighting volume they read in the marks the image prepared
 * for it (`holdVolumeMarks`), if it did: the reference marks both in the one pass. The transparents are prepared this image (`radianceMarker`),
 * and the pass comes before the pool's kernels; it draws them on a group of its own, which names no light. None without runs, a depth pyramid or a
 * compiled stage (asked, the mark skipped meanwhile). Without an opaque depth drawn this image the pyramid is not tested. Returns the draws encoded.
 */
function drawRadianceMark(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  grid: GPUBuffer,
  marks: GPUBuffer,
  settings: TranslucentMarkSettings,
) {
  const { gpu, run } = rt
  const drawable = markDrawable(rt)
  if (!drawable) return 0
  const { depth, set } = drawable
  const [width, height] = translucentMarkTarget(gpu.targetSize, settings.downsample)
  const state = stateOf(rt, device)
  state.write(settingsOver(settings, run.depthDrawn), gpu.targetSize)
  const volume = state.volume ?? state.noVolume
  state.volume = undefined
  const pass = encoder.beginRenderPass({
    label: RADIANCE_MARK_PASS,
    colorAttachments: [],
    depthStencilAttachment: { view: state.target.view(width, height), depthReadOnly: true },
  })
  pass.setBindGroup(RADIANCE_MARK_GROUP, markGroup(device, state, grid, marks, depth, volume))
  // No reflection read; any order (a mark is a bit set, the same whichever fragment sets it); no water.
  const encoded = drawBlendRuns(rt, device, pass, set, {
    reflected: false,
    group: itemsGroup(rt, device, state),
  })
  pass.end()
  run.gpuDrawCalls += encoded
  return encoded
}

/** The translucency volume's marks the image prepared (`prepareTranslucencyVolumeMarks`), held for the mark pass that draws them: the pool's
 *  (`radianceMarker`), else `drawHeldVolumeMarks`. None (the image marks none) lets go of the last image's. */
export function holdVolumeMarks(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  marks: VolumeMarks | undefined,
) {
  if (marks) stateOf(rt, device).volume = marks
  else {
    const state = kept.get(rt)
    if (state) state.volume = undefined
  }
}

/**
 * The mark pass for the volume's marks alone, where the radiance cache marked none this image (no screen probes cast, no probes, the mark off):
 * the reference runs the same pass whether the radiance cache marks or the lighting volume is marked
 * (`MarkRadianceCache` off, a placeholder in the place of the cache's marks). The marks the image held and no pass drew are drawn now, the
 * radiance cache's resources replaced by the stand-ins (`bounceGrid` at zero marks nothing), the settings those of the translucent mark.
 * Returns the draws encoded.
 */
export function drawHeldVolumeMarks(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const state = kept.get(rt)
  const placeholders = rt.gpu.deferred?.placeholders
  if (!state?.volume || !placeholders) return 0
  const { values, cache } = screenProbeSettingsOf(rt)
  // The mark's own settings where the radiance cache marks, else the same factor and depth test (no fragment fades: the cache marks none).
  const settings = cache.translucentMark ?? translucentMarkSettings(values, 1)
  return drawRadianceMark(
    rt,
    device,
    encoder,
    placeholders.bounceGrid,
    placeholders.sunRanks,
    settings,
  )
}

/** The marks of the translucent surfaces a runtime's pool runs, and the device each was made for. */
const markers = new WeakMap<WebgpuPagesRuntime, { device: GPUDevice; marker: TranslucentMarker }>()

/** The translucent surfaces' mark of the radiance cache for the pool (`MarkSurface.translucent`): the image's transparents drawn through the
 *  mark stage, on a group of its own that names no light (`drawRadianceMark`). None unless `prepared`: the transparents were prepared this image
 *  (`prepareBlend`). */
export function radianceMarker(rt: WebgpuPagesRuntime, device: GPUDevice, prepared: boolean) {
  if (!prepared) return undefined
  let held = markers.get(rt)
  if (held?.device !== device)
    markers.set(
      rt,
      (held = {
        device,
        marker: {
          mark: (encoder, grid, marks, settings) =>
            drawRadianceMark(rt, device, encoder, grid, marks, settings) as unknown as void,
        },
      }),
    )
  return held.marker
}
