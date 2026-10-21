import { definePass } from '../diagnostic/stage/passDeclaration.ts'

/** Timestamp label published by the existing per-frame GPU timing recorder: the deformation
 *  stage's (`compute.ts`), which the core's metrics read without its code. */
export const DEFORMATION_PASS = 'Trillion3D deformation'
/** The animation banks' pass (`compute.ts`, `bankWgsl.ts`): every track's palettes posed from its
 *  bake, before the deformation stage reads them. */
export const ANIMATION_BANK_PASS = 'Trillion3D animation banks'

export const DEFORMATION_PASSES = [
  definePass({ label: DEFORMATION_PASS, stage: 'animations', block: 'other' }),
  definePass({ label: ANIMATION_BANK_PASS, stage: 'animations', block: 'other' }),
]
