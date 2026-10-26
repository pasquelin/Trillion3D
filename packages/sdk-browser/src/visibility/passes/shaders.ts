import { grantsVertexTextures } from '../../gpu/core/vertexTextures.ts'
import { shaderErrors } from '../../gpu/core/shaderModule.ts'
import { SHADE_UNIFORM_BYTES } from '../shader/request.ts'
import { SHADE_SHADER, shadeShader } from '../shader/shadeWgsl.ts'
import { visShader } from '../shader/visWgsl.ts'
import type { Clipping } from '../../gpu/core/clipDistances.ts'
import { NO_MASKS, type MaskSet } from '../../materials/graph/maskProgram.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import {
  VIS_BINDINGS,
  VIS_UNIFORM_BYTES,
  atlasLayoutEntries,
  visUniformBuffer,
} from '../../gpu/bind/bindLayout.ts'
import {
  DIAGNOSTIC_SHADE_WGSL,
  diagnosticVisWgsl,
  variesShade,
  variesVisibility,
} from '../../diagnostic/gpuGeometry.ts'
import { hasWideAtomics } from '../../gpu/core/wideAtomics.ts'
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
  storageTextureLayout,
} from '../../gpu/core/computeBindings.ts'
import { BLUE_NOISE_FORMAT } from '../../gpu/noise/blueNoiseTextures.ts'
import { graphFrameEntry } from '../shader/graphFrameWgsl.ts'

/** Zeros, bound where a pass has nothing to read: the direct path's instance and slot lists
 *  (`./bindings.ts`), a ray batch's missing geometry. A read past it is zero as well. */
const zeroRowsBuffer = (device: GPUDevice) =>
  device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE })

/** The visibility raster's group 0, entry by entry: what every pass drawing decoded clusters binds. */
export function visLayoutEntries(vertexTextures = false): GPUBindGroupLayoutEntry[] {
  const b = VIS_BINDINGS
  // The colour atlas is read by the fragments (the cutout) and, where the device lets a vertex stage
  // bind the storage buffers it needs (`grantsVertexTextures`), by the vertices (an offset's texture
  // reads, at an explicit level).
  const atlas = vertexTextures
    ? GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX
    : GPUShaderStage.FRAGMENT
  return [
    computeBufferEntry(b.cache, 'read-only-storage', GPUShaderStage.VERTEX),
    computeBufferEntry(b.position, 'read-only-storage', GPUShaderStage.VERTEX),
    computeBufferEntry(
      b.pageTable,
      'read-only-storage',
      GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    ),
    // The fragment reads the texture level bias (`atlasLod`, `uni.mipBias`).
    computeUniformEntry(
      b.uniform,
      { minBindingSize: VIS_UNIFORM_BYTES },
      GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    ),
    computeBufferEntry(b.uv, 'read-only-storage', GPUShaderStage.VERTEX),
    ...atlasLayoutEntries(b.color, atlas),
    computeSamplerEntry(b.sampler, 'filtering', atlas),
    computeBufferEntry(b.instances, 'read-only-storage', GPUShaderStage.VERTEX),
    computeBufferEntry(b.slotOffsets, 'read-only-storage', GPUShaderStage.VERTEX),
    // The surfaces' records: a row's shape in its vertices, its cutout in its fragments.
    computeTextureEntry(
      b.material,
      'uint',
      '2d-array',
      GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    ),
    // The float pool's normal atlas: a float geometry's second UV set, a cutout's coordinate.
    computeTextureEntry(b.normals, 'unfilterable-float', '2d-array', GPUShaderStage.VERTEX),
    // The graph frame: the clocks and the camera a cutout and an offset read.
    graphFrameEntry(b.frame, GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT),
    // The blue noise a dithered cutout is cut by: read by load, by the fragments alone.
    {
      binding: b.noise,
      visibility: GPUShaderStage.FRAGMENT,
      ...storageTextureLayout(BLUE_NOISE_FORMAT),
    },
  ]
}

/**
 * The visibility raster's module, validated: with no variant, the one from before — production
 * compiles no diagnostic stage —, cutting at a view's plane where the project switch is on
 * (`clipping`). The graphs' masks the session's surfaces wire are cut here and by every raster after
 * it, and the offsets they wire move the vertices here and in every pass after it; made again when a
 * graph joins the session (`../../frame/prepare/lateGraphs.ts`).
 */
export async function createVisModule(
  device: GPUDevice,
  variant?: DiagnosticGpuVariant,
  clipping?: Clipping,
  masks: MaskSet = NO_MASKS,
  wpo: WpoSet = NO_WPO,
) {
  const wide = hasWideAtomics(device)
  const visModule = device.createShaderModule({
    code: visShader({
      ...(variesVisibility(variant) && { diagnostic: diagnosticVisWgsl(wide) }),
      clipping,
      masks,
      wpo,
      wide,
    }),
  })
  if ((await shaderErrors(visModule)).length) throw new Error('VIS_SHADER')
  return visModule
}

/** Allocates visibility uniforms and validates both shader modules before pipeline creation. The
 *  resolve module serves its pipelines with the feedback target and without it alike: its request
 *  is folded by their `FEEDBACK` constant (`feedbackConstants`). */
export async function createWebgpuVisibilityShaders(
  device: GPUDevice,
  slotCount = 7,
  variant?: DiagnosticGpuVariant,
  clipping?: Clipping,
  masks: MaskSet = NO_MASKS,
  wpo: WpoSet = NO_WPO,
) {
  const shadeUniform = device.createBuffer({
    label: 'Trillion3D resolve uniform',
    size: SHADE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const visBindGroupLayout = device.createBindGroupLayout({
    entries: visLayoutEntries(grantsVertexTextures(device)),
  })
  // WebGPU hands back a zeroed buffer and nothing ever writes to this one.
  const zeroRows = zeroRowsBuffer(device)
  const visUniform = visUniformBuffer(device, slotCount)
  const visMade = createVisModule(device, variant, clipping, masks, wpo)
  const shadeModule = device.createShaderModule({
    code: variesShade(variant) ? shadeShader({ diagnostic: DIAGNOSTIC_SHADE_WGSL }) : SHADE_SHADER,
  })
  const visModule = await visMade
  const shadeErrors = await shaderErrors(shadeModule)
  if (shadeErrors.length)
    throw new Error('SHADE_SHADER: ' + shadeErrors.map((message) => message.message).join(' | '))
  return {
    shadeUniform,
    visBindGroupLayout,
    zeroRows,
    visUniform,
    visModule,
    shadeModule,
  }
}
