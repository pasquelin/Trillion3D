import { definePass } from '../stage/passDeclaration.ts'

/** The label of the pass reprojecting the last lit image to this one's pixels, the source every
 *  screen reflection reads (`encode.ts`); a GPU timing names the pass by it. */
export const REFLECTION_SOURCE_PASS = 'Trillion3D reflection source'

export const REFLECTION_SOURCE_PASSES = [
  definePass({ label: REFLECTION_SOURCE_PASS, stage: 'reflections', block: 'other' }),
]
