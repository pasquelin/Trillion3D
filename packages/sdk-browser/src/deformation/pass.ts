import { definePass } from '../stage/passDeclaration.ts'

/** Timestamp label published by the existing per-frame GPU timing recorder: the deformation
 *  stage's (`compute.ts`), which the core's metrics read without its code. */
export const DEFORMATION_PASS = 'Trillion3D deformation'

export const DEFORMATION_PASSES = [
  definePass({ label: DEFORMATION_PASS, stage: 'animations', block: 'other' }),
]
