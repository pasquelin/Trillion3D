import type { CloudShadowBindings } from './cloudShadowRead.ts'

/** Where every atmosphere program binds what it reads and writes, in group 0: one table of
 *  numbers, so that the passes and their shaders agree. A program binds only what it names
 *  (`boundNames`, `programs.ts`). */
export const AIR_BINDING = {
  /** The light buffer's front: the atmosphere's block, the view's block and the haze volume. */
  air: 0,
  /** The table a program writes: a storage texture. */
  table: 1,
  /** The transmittance table, sampled. */
  transmittance: 2,
  /** The multiple-scattering table, sampled. */
  multiScatter: 3,
  /** The tables' sampler: linear, clamped. */
  sampler: 4,
  /** The image's frame (`frame.ts`). */
  frame: 5,
  /** The sky table seen from the eye, sampled. */
  skyView: 7,
  /** The surface flags, which tell the sky's pixels from a surface's. */
  flags: 8,
  /** What the fog laid over the clouds reads past the light buffer (`AIR_FOG_BINDINGS`): the sampler
   *  its cubemap and volume are read through, the cubemap and the volume. */
  fogSampler: 9,
  fogCubemap: 10,
  fogVolume: 11,
  /** The virtual shadow maps the air's lights shade it with: the page table, the projection data,
   *  the uniforms, the pool's first slice, and the projection's view (`airShadowWgsl.ts`). */
  pageTable: 12,
  projectionData: 13,
  shadowUniforms: 14,
  shadowPool: 15,
  shadowView: 16,
  /** The spatiotemporal blue noise a marched sky pixel jitters its samples by. */
  noise: 17,
  /** The volumes the clouds read besides the haze: the haze's light alone and the air's, then the
   *  volume around a capture (`separatedWgsl.ts`), a storage buffer. */
  volumes: 18,
  /** The clouds' shade (`cloudShadowRead.ts`): the block of the matrices and strengths, and the
   *  maps of the air's two lights; they are read through the tables' sampler. */
  cloudShadow: 19,
  cloudShadowMap0: 20,
  cloudShadowMap1: 21,
  /** The scene's depth, which the haze marched on the opaque surfaces reads (`opaqueHazeWgsl.ts`). */
  depth: 22,
  /** The clouds' sky occlusion map (`cloudShadowRead.ts`), bound with the clouds' shade and read
   *  through the same sampler: the marches that read the shade dim the multiple scattering by it. */
  cloudSkyAO: 24,
  /** The lists of the local fog volumes over each tile of the view the fog laid over the
   *  clouds reads (`AIR_FOG_BINDINGS`, `fogTilesWgsl`, `../fog/localWgsl.ts`), a read-only storage buffer of words. */
  fogTiles: 25,
  /** The volume of the haze as a 3D texture, which the haze pass writes beside the light buffer's
   *  region and the fog pass samples (`hazeSampledWgsl`, `../fog/fogPass.ts`): a storage texture. */
  hazeVolume: 26,
} as const

/** The name of a binding. */
export type AirBindingName = keyof typeof AIR_BINDING

/** Where the air's programs bind the clouds' shade: in group 0, read through the tables' sampler. */
export const AIR_CLOUD_SHADOW: CloudShadowBindings = {
  group: 0,
  block: AIR_BINDING.cloudShadow,
  map0: AIR_BINDING.cloudShadowMap0,
  map1: AIR_BINDING.cloudShadowMap1,
  ao: AIR_BINDING.cloudSkyAO,
  samplerName: 'tableSampler',
}
