import { definePass } from '../stage/passDeclaration.ts'

/** Label of the compute pass that builds a batch of material chains, counts and reductions. */
export const TEXTURE_MIPS_PASS = 'Trillion3D texture mips'
/** The reflection's pyramids, built each image they are read (`../reflections/conePyramid.ts`):
 *  named apart from the material textures', whose chains are built once, so a frame's passes
 *  say which work is the reflection's. */
export const REFLECTION_RADIANCE_MIPS_PASS = 'Trillion3D reflection radiance mips'
export const REFLECTION_BOUNDS_MIPS_PASS = 'Trillion3D reflection depth bounds mips'

/** The mip passes: the material chains with the textures, the pyramids with the reflections. */
export const MIPS_PASSES = [
  definePass({ label: TEXTURE_MIPS_PASS, stage: 'textures', block: 'other' }),
  definePass({ label: REFLECTION_RADIANCE_MIPS_PASS, stage: 'reflections', block: 'other' }),
  definePass({ label: REFLECTION_BOUNDS_MIPS_PASS, stage: 'reflections', block: 'other' }),
]
