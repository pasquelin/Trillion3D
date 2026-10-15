import { FEEDBACK_FORMAT } from './targetFormats.ts'
import type { FragmentOutput } from '../gpu/core/fragmentOutputs.ts'

/** THE SURFACE TARGETS a pass writes before lighting, in their locations' order: name, WGSL type,
 *  format. The opaque resolve, the water surfaces and the impostor cards build their output
 *  structs (`fragmentMembers`) and their targets (`fragmentTargets`) from this one table
 *  (`surfaceBuffer.ts` holds what each one stores). */
export const SURFACE_OUTPUTS = [
  { name: 'baseMetal', wgsl: 'vec4f', format: 'rgba16float' },
  { name: 'normalRough', wgsl: 'vec4f', format: 'rgba16float' },
  { name: 'emissiveAo', wgsl: 'vec4f', format: 'rgba16float' },
  { name: 'flags', wgsl: 'u32', format: 'r8uint' },
] as const satisfies readonly FragmentOutput[]
/** The tile rank a surface pixel asks of the virtual textures, after the surfaces: the feedback
 *  target, which the pipelines write or not (`FEEDBACK`, `../webgpu/tile/requestWgsl.ts`). */
export const REQUEST_OUTPUT = { name: 'request', wgsl: 'u32', format: FEEDBACK_FORMAT } as const
