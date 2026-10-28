import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeUniformEntry,
} from '../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { grantsVertexTextures } from '../gpu/core/vertexTextures.ts'
import { blendLayoutEntries } from '../gpu/bind/blendBindEntries.ts'
import { BLEND_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { hizDepthEntries } from '../visibility/hiz/gpu/pyramidTexture.ts'
import { TRANSLUCENT_MARK_BINDINGS } from '../lighting/bounce/pool/translucentMark.ts'
import { stageDescriptors, type FrontStagePipelines } from './stagePipelines.ts'
import { stageOfCulls } from './frontStage.ts'
import { BLEND_VIEW_SIZE } from './viewLayout.ts'
import { MARK_FORMAT } from '../lighting/translucency/layout.ts'
import {
  blendRadianceMarkShader,
  RADIANCE_MARK_DEPTH_BINDING,
  VOLUME_MARK_FRAME_BINDING,
  VOLUME_MARK_TEXTURE_BINDING,
} from './radianceMarkWgsl.ts'
import type { Clipping } from '../gpu/core/clipDistances.ts'
import type { SurfaceProgram } from '../materials/graph/surfaceProgram.ts'
import { NO_WPO, type WpoSet } from '../materials/graph/wpoProgram.ts'

/** The format of the depth the mark pass holds for its attachment alone: a pass needs one, and the pass tests and writes none. */
export const RADIANCE_MARK_TARGET_FORMAT: GPUTextureFormat = 'depth16unorm'

/** The blend group's bindings the mark stage reads: the geometry, the items' records, the view, the surfaces' records and the two atlases with
 *  their sampler, and the graph frame. The lights, shadows, fog and the layers' volumes are not read, so they are not in its layout. */
const MARK_BLEND_BINDINGS: ReadonlySet<number> = new Set([
  BLEND_BINDINGS.indices,
  BLEND_BINDINGS.positions,
  BLEND_BINDINGS.uvs,
  BLEND_BINDINGS.uniform,
  BLEND_BINDINGS.items,
  BLEND_BINDINGS.sampler,
  BLEND_BINDINGS.normals,
  BLEND_BINDINGS.planInstances,
  BLEND_BINDINGS.clusterSpans,
  BLEND_BINDINGS.material,
  BLEND_BINDINGS.frame,
  ...BLEND_BINDINGS.color.lanes,
  BLEND_BINDINGS.color.pages,
  ...BLEND_BINDINGS.data.lanes,
  BLEND_BINDINGS.data.pages,
])

/** Whether the blend group's entry `entry` is one the mark stage reads (`MARK_BLEND_BINDINGS`). */
export const readByRadianceMark = (entry: { binding: number }) =>
  MARK_BLEND_BINDINGS.has(entry.binding)

/** The first group's layout of the mark stage, once a device: the blend group's entries it reads, as the blend layout declares them
 *  (`blendLayoutEntries`), none of the others, so that its fragment stage holds two storage buffers of the eight a stage is granted, with the bitmap's. */
export const radianceMarkBlendLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D translucent radiance mark items',
    entries: blendLayoutEntries(BLEND_VIEW_SIZE, grantsVertexTextures(device)).filter(
      readByRadianceMark,
    ),
  }),
)

/** The mark group's layout (after the blend group's), once a device: the parameters and the levels' uniform, the bitmap the fragments mark,
 *  the depth pyramid, and the translucency volume's frame and marks (`translucencyVolumeMarkWgsl`), all seen by the fragment stage. */
export const radianceMarkLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D translucent radiance mark',
    entries: [
      computeUniformEntry(TRANSLUCENT_MARK_BINDINGS.params, {}, GPUShaderStage.FRAGMENT),
      computeUniformEntry(TRANSLUCENT_MARK_BINDINGS.grid, {}, GPUShaderStage.FRAGMENT),
      computeBufferEntry(TRANSLUCENT_MARK_BINDINGS.marks, 'storage', GPUShaderStage.FRAGMENT),
      ...hizDepthEntries(RADIANCE_MARK_DEPTH_BINDING, GPUShaderStage.FRAGMENT),
      computeUniformEntry(VOLUME_MARK_FRAME_BINDING, {}, GPUShaderStage.FRAGMENT),
      computeStorageTextureEntry(
        VOLUME_MARK_TEXTURE_BINDING,
        MARK_FORMAT,
        'write-only',
        '3d',
        GPUShaderStage.FRAGMENT,
      ),
    ],
  }),
)

/** The radiance mark stage's pipelines of a device's blend layout (`radianceMarkWgsl.ts`): three culls on the group of what it reads of the blend's (`radianceMarkBlendLayout`) then the mark's,
 *  no colour, and the dummy depth attachment's format, never tested nor written. Described and compiled at the first ask, a frame's that
 *  marks. `clipping`, `graphs` and `offsets` are the blend programs' (`createFrontStages`). */
export function createRadianceMarkStage(
  device: GPUDevice,
  clipping?: Clipping,
  graphs: readonly SurfaceProgram[] = [],
  offsets: WpoSet = NO_WPO,
): FrontStagePipelines {
  return stageOfCulls(device, () => {
    const module = device.createShaderModule({
      label: 'Trillion3D translucent radiance mark',
      code: blendRadianceMarkShader(clipping, graphs, offsets),
    })
    const fragment = { module, entryPoint: 'fsRadianceMark', targets: [] }
    return stageDescriptors(
      device,
      module,
      radianceMarkBlendLayout(device),
      fragment,
      false,
      [radianceMarkLayout(device)],
      { format: RADIANCE_MARK_TARGET_FORMAT, depthCompare: 'always' },
    )
  })
}

/** Prepare's compile of the mark stage, where the settings mark the radiance cache from the translucent surfaces (`marks`) and the scene has any
 *  (`items`), off the frame as the front stage's is (`prepareFrontStage`); none else, and a refusal leaves the mark asked at its first frame. */
export const prepareRadianceMarkStage = (
  stage: FrontStagePipelines,
  items: readonly unknown[],
  marks: boolean,
) => (marks && items.length ? stage.prepare().catch(() => undefined) : undefined)
