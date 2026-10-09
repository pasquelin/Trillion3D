import { definePass } from '../stage/passDeclaration.ts'

/** Label of the compute pass that builds a batch of material chains, counts and reductions. */
export const TEXTURE_MIPS_PASS = 'Trillion3D texture mips'

/** The mip passes: the material chains with the textures. */
export const MIPS_PASSES = [
  definePass({ label: TEXTURE_MIPS_PASS, stage: 'textures', block: 'other' }),
]
