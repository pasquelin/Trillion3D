// How a GPU pass declares itself to the profile: its label, its stage and its block, once, in the
// label module the pass reads its label from. The pass table gathers those declarations
// (`passTable.ts`); this module imports nothing, so a label module stays as light as its words.

/** Stages the WebGPU engine can name, in the order they occur. */
export const WEBGPU_STAGES = [
  'physics',
  'animations',
  'lights',
  'cutAdoption',
  'selection',
  'transparents',
  'residency',
  'hostPages',
  'uploads',
  'textures',
  'partition',
  'encode',
  'submit',
  'hiZ',
  'geometry',
  'coplanar',
  'shadows',
  'shadowCasters',
  'lightLists',
  'bounce',
  'reflections',
  'lighting',
  'antialiasing',
  'effects',
  'present',
] as const

/** A stage of the WebGPU engine's profile. */
export type WebgpuStage = (typeof WEBGPU_STAGES)[number]

/**
 * The two blocks of a frame that can be set against a published profile, and nothing else.
 * `visibility` is building the visibility buffer: selection, partition, Hi-Z and raster.
 * `materials` is writing surfaces from that buffer. Everything else is `other`: shadows, light
 * lists, bounce, transparents, deferred lighting and present — putting any of those in a block
 * would inflate a comparison instead of serving it, so they stay outside AND named, each pass
 * keeping its duration.
 */
export type GpuPassBlock = 'visibility' | 'materials' | 'other'

/** Where the profile files a pass's duration: its stage and its block. */
export type PassFiling = { readonly stage: WebgpuStage; readonly block: GpuPassBlock }

/** A pass the engine begins under `label`, filed on its stage and block. */
export type PassDeclaration = PassFiling & { readonly label: string }

/** A family of passes whose labels all open with `prefix`, filed on one stage and block: passes
 *  whose labels carry what they work on (a chunk, a set, a kernel) and so cannot be listed. */
type PassFamilyDeclaration = PassFiling & { readonly prefix: string }

/** Declares a pass: the one place its label meets its stage and block. */
export const definePass = (pass: PassDeclaration): PassDeclaration => Object.freeze(pass)

/** Declares a family of passes by the prefix their labels open with. */
export const definePassFamily = (family: PassFamilyDeclaration): PassFamilyDeclaration =>
  Object.freeze(family)
