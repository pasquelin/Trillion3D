/**
 * WHERE THE SAMPLED LIGHTING'S VOLUME BINDS what it reads and writes, in group 0 of every program that touches it (its sampling and hash, the fog's scatter, the translucency volume's injection): one
 * table, so that the programs, their layouts and their bind groups agree. The sampling's own programs bind the light buffer and the light grid's lists, the light functions' atlas, the depth pyramid and
 * the global distance field at the numbers below too.
 */
import type { CloudShadowBindings } from '../atmosphere/cloudShadowRead.ts'

export const ML_BINDING = {
  lights: 0,
  tiles: 1,
  /** The depth pyramid (three bindings from this one). */
  hiz: 18,
  lightFunction: 28,
  /** The global distance field (six bindings from this one). */
  field: 70,
  /** The volume's uniform. */
  params: 80,
  /** The samples: written by the sampling, read by the hash and the readers. */
  samplesOut: 81,
  samplesIn: 82,
  /** The sets of the lights each tile drew in the image before (read by the sampling) and in this one (written by the hash). */
  hashHistory: 83,
  hashOut: 84,
  /** The ratios of the lights' power since the image before (`lightPower.ts`), read by the sampling. */
  ratios: 85,
} as const

/** Where the sampling binds the clouds' shade (the block, the two maps and the sampler they are read through), which weighs the sun it holds by the clouds above the voxel. */
export const ML_CLOUD_SHADOW: CloudShadowBindings = {
  group: 0,
  block: 29,
  map0: 30,
  map1: 31,
  sampler: 7,
}
