/**
 * WHAT THE WORLD ASKS OF THE BLEND PROGRAMS, as one value: the water's cut for a world that holds an exclusion volume (the programs hold the volumes' lane and
 * table), and the project switch `translucentObjectShadows` (the programs read their object's shadow, their group-0 layouts holding the read's bindings).
 * Programs are made for one variant and built again when the world asks another (`followBlendWorld`, `followFeedback`): asking, "the programs follow it" and
 * "a build was refused for it" are each one comparison of `variantKey`.
 */
export type BlendVariant = { readonly exclusion: boolean; readonly objectShadow: boolean }

/** The variant of a world without an exclusion volume and with the object shadow switch off: the programs as they were made before either. */
export const PLAIN_VARIANT: BlendVariant = { exclusion: false, objectShadow: false }

/** The variant as a string: two variants are the same when their keys are. */
export const variantKey = (variant: BlendVariant) =>
  `${variant.exclusion ? 'x' : '-'}${variant.objectShadow ? 'o' : '-'}`
