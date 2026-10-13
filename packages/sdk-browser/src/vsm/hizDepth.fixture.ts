import type { HizDepth } from '../gpu/hiz/types.ts'

/** A depth pyramid for the tests whose device is a stand-in: the four resources the bind group
 *  names, the object it follows. */
export const fakeHizDepth = {
  resources: [{}, {}, { buffer: {} }, {}],
} as unknown as HizDepth
