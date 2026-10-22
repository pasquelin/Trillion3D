import { shaderErrors } from '../../gpu/core/shaderModule.ts'
import { SHADE_UNIFORM_BYTES } from '../shader/request.ts'
import { SHADE_SHADER, shadeShader } from '../shader/shadeWgsl.ts'
import { VIS_SHADER, visShader } from '../shader/visWgsl.ts'
import { hasClipDistances } from '../../gpu/core/clipDistances.ts'
import {
  VIS_BINDINGS,
  VIS_UNIFORM_BYTES,
  atlasLayoutEntries,
  visUniformBuffer,
} from '../../gpu/bind/bindLayout.ts'
import {
  DIAGNOSTIC_SHADE_WGSL,
  DIAGNOSTIC_VIS_WGSL,
  variesShade,
  variesVisibility,
} from '../../diagnostic/gpuGeometry.ts'
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'

/** Zeros for `drawSlots` rows, bound where a pass has nothing to read: the direct path's instance
 *  and slot lists (`./bindings.ts`), a ray batch's missing geometry; made again when the table
 *  grows (`../../frame/prepare/growTables.ts`). */
export const zeroRowsBuffer = (device: GPUDevice, drawSlots: number) =>
  device.createBuffer({ size: Math.max(4, drawSlots * 4), usage: GPUBufferUsage.STORAGE })

/** The visibility raster's group 0, entry by entry: what every pass drawing page-table rows binds. */
export function visLayoutEntries(): GPUBindGroupLayoutEntry[] {
  const b = VIS_BINDINGS
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
    ...atlasLayoutEntries(b.color),
    computeSamplerEntry(b.sampler, 'filtering', GPUShaderStage.FRAGMENT),
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
  ]
}

/** Allocates visibility uniforms and validates both shader modules before pipeline creation. The
 *  resolve module serves its pipelines with the feedback target and without it alike: its request
 *  is folded by their `FEEDBACK` constant (`feedbackConstants`). */
export async function createWebgpuVisibilityShaders(
  device: GPUDevice,
  drawSlots: number,
  slotCount = 7,
  variant?: DiagnosticGpuVariant,
) {
  const shadeUniform = device.createBuffer({
    label: 'Trillion3D resolve uniform',
    size: SHADE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const visBindGroupLayout = device.createBindGroupLayout({ entries: visLayoutEntries() })
  // WebGPU hands back a zeroed buffer and nothing ever writes to this one.
  const zeroRows = zeroRowsBuffer(device, drawSlots)
  const visUniform = visUniformBuffer(device, slotCount)
  // With no variant, the two modules are exactly those from before: production compiles no
  // diagnostic stage.
  // Cutting a primitive at the view's plane is the hardware's where the device grants it
  // (`../../gpu/core/clipDistances.ts`).
  const clipDistances = hasClipDistances(device)
  const visModule = device.createShaderModule({
    code: variesVisibility(variant)
      ? visShader({ diagnostic: DIAGNOSTIC_VIS_WGSL, clipDistances })
      : clipDistances
        ? visShader({ clipDistances })
        : VIS_SHADER,
  })
  const shadeModule = device.createShaderModule({
    code: variesShade(variant) ? shadeShader({ diagnostic: DIAGNOSTIC_SHADE_WGSL }) : SHADE_SHADER,
  })
  if ((await shaderErrors(visModule)).length) throw new Error('VIS_SHADER')
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
