/**
 * A fragment stage's outputs as one ordered table: each output's field name and WGSL type, and the
 * format of the target it writes. The pipeline's colour targets, the WGSL struct's locations and its
 * zero tuple are all read from the one list, so they agree slot for slot.
 */
export type FragmentField = { readonly name: string; readonly wgsl: string }
export type FragmentOutput = FragmentField & { readonly format: GPUTextureFormat }

/** The colour targets of `outputs`, in their order. */
export const fragmentTargets = (outputs: readonly FragmentOutput[]): GPUColorTargetState[] =>
  outputs.map(({ format }) => ({ format }))

/** The members of an output struct of `fields`, each at its location in their order. */
export const fragmentMembers = (fields: readonly FragmentField[]) =>
  fields.map(({ name, wgsl }, at) => `@location(${at}) ${name}:${wgsl},`).join('')

/** The zero of each of `fields`, in their order, as a constructor's arguments. */
export const fragmentZeros = (fields: readonly FragmentField[]) =>
  fields
    .map(({ wgsl }) => (wgsl === 'u32' ? '0u' : `${wgsl}(0${wgsl.endsWith('u') ? 'u' : '.0'})`))
    .join(',')
