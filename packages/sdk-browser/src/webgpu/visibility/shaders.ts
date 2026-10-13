import { shaderErrors } from '../../gpu/core/shaderModule.ts'
import { SHADE_UNIFORM_BYTES } from '../../visibility/shader/request.ts'
import { SHADE_SHADER, shadeShader } from '../../visibility/shader/shadeWgsl.ts'
import { VIS_SHADER, visShader } from '../../visibility/shader/visWgsl.ts'
import {
  VIS_BINDINGS,
  VIS_UNIFORM_BYTES,
  atlasLayoutEntries,
  visUniformLayout,
} from '../core/bindLayout.ts'
import {
  DIAGNOSTIC_SHADE_WGSL,
  DIAGNOSTIC_VIS_WGSL,
  variesShade,
  variesVisibility,
} from '../../diagnostic/gpuGeometry.ts'
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts'
import { feedbackFreeEntry } from '../tile/feedbackAbWgsl.ts'
import { computeBufferEntry, computeUniformEntry } from '../../gpu/core/computeBindings.ts'

/** Zeros for `drawSlots` rows, which the untested passes bind where the tested ones read verdicts;
 *  made again when the table grows (`../pages/prepare/growTables.ts`). */
export const zeroFlagsBuffer = (device: GPUDevice, drawSlots: number) =>
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
    computeBufferEntry(b.flags, 'read-only-storage', GPUShaderStage.VERTEX),
    // The fragment reads the texture level bias (`atlasLod`, `uni.mipBias`).
    computeUniformEntry(
      b.uniform,
      { minBindingSize: VIS_UNIFORM_BYTES },
      GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    ),
    computeBufferEntry(b.uv, 'read-only-storage', GPUShaderStage.VERTEX),
    ...atlasLayoutEntries(b.color),
    { binding: b.sampler, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    computeBufferEntry(b.instances, 'read-only-storage', GPUShaderStage.VERTEX),
    computeBufferEntry(b.slotOffsets, 'read-only-storage', GPUShaderStage.VERTEX),
  ]
}

/** The resolve module whose `shade_fsWithoutFeedback` writes the four surfaces alone: the same
 *  `shade_fs` body, its request dropped (`feedbackFreeEntry`). A scene that wears no texture, and
 *  the feedback A/B's arm without the target, resolve with it. */
export const shadeWithoutFeedbackCode = () =>
  feedbackFreeEntry(
    SHADE_SHADER,
    'shade_fs',
    'SurfaceOut',
    [
      ['baseMetal', 'vec4f'],
      ['normalRough', 'vec4f'],
      ['emissiveAo', 'vec4f'],
      ['flags', 'u32'],
    ],
    '@builtin(position) pos:vec4f',
    'pos',
  )

/** Allocates visibility uniforms and validates both shader modules before pipeline creation.
 *  `feedback` false makes the resolve module the one without a feedback output
 *  (`shadeWithoutFeedbackCode`); the feedback A/B gets that one beside the other. */
export async function createWebgpuVisibilityShaders(
  device: GPUDevice,
  drawSlots: number,
  slotCount = 7,
  variant?: DiagnosticGpuVariant,
  feedbackAB = false,
  feedback = true,
) {
  const shadeUniform = device.createBuffer({
    label: 'Trillion3D resolve uniform',
    size: SHADE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const visBindGroupLayout = device.createBindGroupLayout({ entries: visLayoutEntries() })
  // The untested passes bind zeros at the same row index the tested ones read, so the buffer spans
  // the row table; WebGPU hands back a zeroed buffer and nothing ever writes to this one.
  const zeroFlags = zeroFlagsBuffer(device, drawSlots)
  const visUniform = device.createBuffer({
    label: 'Trillion3D visibility uniforms',
    size: visUniformLayout(device.limits, slotCount).bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // With no variant, the two modules are exactly those from before: production compiles no
  // diagnostic stage.
  const visModule = device.createShaderModule({
    code: variesVisibility(variant) ? visShader({ diagnostic: DIAGNOSTIC_VIS_WGSL }) : VIS_SHADER,
  })
  const withoutFeedback = () => device.createShaderModule({ code: shadeWithoutFeedbackCode() })
  const shadeModule = feedback
    ? device.createShaderModule({
        code: variesShade(variant)
          ? shadeShader({ diagnostic: DIAGNOSTIC_SHADE_WGSL })
          : SHADE_SHADER,
      })
    : withoutFeedback()
  const shadeWithoutFeedback = feedbackAB ? withoutFeedback() : undefined
  if ((await shaderErrors(visModule)).length) throw new Error('VIS_SHADER')
  const shadeErrors = await shaderErrors(shadeModule)
  if (shadeErrors.length)
    throw new Error('SHADE_SHADER: ' + shadeErrors.map((message) => message.message).join(' | '))
  if (shadeWithoutFeedback && (await shaderErrors(shadeWithoutFeedback)).length)
    throw new Error('SHADE_WITHOUT_FEEDBACK_SHADER')
  return {
    shadeUniform,
    visBindGroupLayout,
    zeroFlags,
    visUniform,
    visModule,
    shadeModule,
    shadeWithoutFeedback,
  }
}
