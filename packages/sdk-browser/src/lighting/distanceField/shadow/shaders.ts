import { DFSH_CULL_WGSL, DFSH_OFFSETS_WGSL } from './cullWgsl.ts'
import { DFSH_FINAL_WGSL } from './finalWgsl.ts'
import { DFSH_SCATTER_WGSL } from './scatterWgsl.ts'
import { DFSH_TRACE_WGSL } from './traceWgsl.ts'

/**
 * EVERY PROGRAM OF THE SUN'S DISTANCE-FIELD SHADOW, by name: the meshes culled to the cascade, the
 * tiles' start offsets, the scatter of the meshes to the tiles (the vertex stage and both of its
 * fragment stages), the trace and the upsample into the mask. The passes compile these
 * (`pipelines.ts`) and the list of the engine's texts holds each.
 */
export const DFSH_SHADERS = {
  cull: DFSH_CULL_WGSL,
  offsets: DFSH_OFFSETS_WGSL,
  scatter: DFSH_SCATTER_WGSL,
  trace: DFSH_TRACE_WGSL,
  final: DFSH_FINAL_WGSL,
} as const
