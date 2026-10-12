import type { HizDepth } from '../gpu/hiz/types.ts'

/** A depth pyramid for the tests whose device is a stand-in: four resources the bind group names
 *  and a texture it follows. */
export const fakeHizDepth = {
  pyramid: {},
  resources: [{}, {}, { buffer: {} }, {}],
} as unknown as HizDepth
