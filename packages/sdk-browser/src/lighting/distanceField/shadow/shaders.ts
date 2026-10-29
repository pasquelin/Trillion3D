import { DFSH_CULL_WGSL, DFSH_OFFSETS_WGSL } from './cullWgsl.ts'
import { DFSH_SCATTER_WGSL } from './scatterWgsl.ts'

/**
 * EVERY PROGRAM OF THE SUNS' MESH LISTS, by name: the meshes culled to the volume, the
 * tiles' start offsets and the scatter of the meshes to the tiles (the vertex stage and both of its
 * fragment stages). The passes compile these (`pipelines.ts`) and the list of the engine's texts holds each.
 */
export const DFSH_SHADERS = {
  cull: DFSH_CULL_WGSL,
  offsets: DFSH_OFFSETS_WGSL,
  scatter: DFSH_SCATTER_WGSL,
} as const
