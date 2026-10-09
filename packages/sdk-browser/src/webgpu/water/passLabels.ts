import { definePass } from '../../stage/passDeclaration.ts'

/** Labels of the two measured passes; their GPU durations are read under these names. */
export const WATER_SURFACE_PASS = 'Trillion3D water surfaces'

export const WATER_COMPOSITE_PASS = 'Trillion3D water composite'

/** The water's passes, drawn with the transparents. */
export const WATER_PASSES = [
  definePass({ label: WATER_SURFACE_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: WATER_COMPOSITE_PASS, stage: 'transparents', block: 'other' }),
]
