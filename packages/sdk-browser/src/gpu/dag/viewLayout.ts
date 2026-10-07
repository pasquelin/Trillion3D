import { alignUp } from '../../../../math/src/scalar/integers.ts'

/**
 * One view's uniform block, described once.
 *
 * The kernels read the block through a WGSL `struct`, and the host fills it by word: `writeDagUniforms`
 * wrote `target[42]` and `ints[54]` against a struct that named every field. Nothing tied the two
 * together, so a field added to one side and not the other would move every word after it and the
 * kernels would read the wrong numbers — a silent image change, not a type error.
 *
 * So the field table below is the only description of the block. From it come the WGSL struct text
 * (`VIEW_UNIFORM_STRUCT`) and the word offsets the host writes (`VIEW_WORD`). Adding a field means
 * adding one line here, and both sides follow.
 *
 * Offsets follow WGSL's own layout rules, in 4-byte words: a field starts at the next multiple of
 * its alignment, and `align` below is that alignment counted in words — 1 for a scalar, 2 for
 * `vec2`, 4 for `vec3`, `vec4`, a matrix and an array. The `vec3` rule is the one that bites:
 * `cameraWorld` is twelve bytes yet cannot start at word 47, it waits for word 48.
 */
type Field = {
  readonly name: string
  readonly type: string
  readonly words: number
  readonly align: number
}

/** The block, in order. `as const` is what makes `FieldName` a union of the field names rather
 *  than `string`: annotated `readonly Field[]`, the literal types widen and a typo in `viewWord`
 *  would compile and throw mid-frame, which is the drift this module exists to prevent. */
const VIEW_FIELDS = [
  { name: 'planes', type: 'array<vec4f,6>', words: 24, align: 4 },
  { name: 'view', type: 'mat4x4f', words: 16, align: 4 },
  { name: 'pixelScale', type: 'vec2f', words: 2, align: 2 },
  { name: 'pixelError', type: 'f32', words: 1, align: 1 },
  { name: 'near', type: 'f32', words: 1, align: 1 },
  { name: 'clusterCount', type: 'u32', words: 1, align: 1 },
  { name: 'nodeCount', type: 'u32', words: 1, align: 1 },
  { name: 'worldCount', type: 'u32', words: 1, align: 1 },
  { name: 'cameraWorld', type: 'vec3f', words: 3, align: 4 },
  { name: 'cameraStretch', type: 'f32', words: 1, align: 1 },
  { name: 'listCap', type: 'u32', words: 1, align: 1 },
  { name: 'perspective', type: 'f32', words: 1, align: 1 },
  { name: 'viewCount', type: 'u32', words: 1, align: 1 },
  { name: 'viewCapacity', type: 'u32', words: 1, align: 1 },
  { name: 'queueCap', type: 'u32', words: 1, align: 1 },
  { name: 'ahead', type: 'u32', words: 1, align: 1 },
  { name: 'admitByLevel', type: 'u32', words: 1, align: 1 },
  { name: 'swapRegions', type: 'u32', words: 1, align: 1 },
  { name: 'worldRoot', type: 'u32', words: 1, align: 1 },
  { name: 'treeTop', type: 'u32', words: 1, align: 1 },
  { name: 'cellBase', type: 'u32', words: 1, align: 1 },
  { name: 'members', type: 'u32', words: 1, align: 1 },
  { name: 'worldLinks', type: 'u32', words: 1, align: 1 },
  { name: 'worldScale', type: 'f32', words: 1, align: 1 },
  { name: 'lightOriginHigh', type: 'vec4f', words: 4, align: 4 },
  { name: 'lightOriginLow', type: 'vec4f', words: 4, align: 4 },
  { name: 'lightPlanes', type: 'array<vec4f,6>', words: 24, align: 4 },
] as const satisfies readonly Field[]

/** The first word of a field, by WGSL's alignment: its offset rounded up to the field's own. */
const firstWord = (field: Field, after: number): number => alignUp(after, field.align)

/** The word each field starts at, in declaration order. */
const VIEW_WORD: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(
    VIEW_FIELDS.reduce<{ at: number; words: [string, number][] }>(
      (acc, field) => {
        const at = firstWord(field, acc.at)
        acc.words.push([field.name, at])
        acc.at = at + field.words
        return acc
      },
      { at: 0, words: [] },
    ).words,
  ),
)

/** Words one view's block holds: the stride of the uniform array, and the size the host allocates. */
export const VIEW_BLOCK_WORDS = VIEW_FIELDS.reduce(
  (at, field) => firstWord(field, at) + field.words,
  0,
)

/** The word a field starts at. `viewWord('ahead')` is where the host writes what the kernels read
 *  as `views[vi].ahead`; nothing else may hold that number.
 *
 *  `field` is a union of the table's names, so a typo is a type error rather than a throw thrown
 *  mid-frame: the compiler and the shader are checked against the same list. */
export const viewWord = (field: FieldName): number => {
  const at = VIEW_WORD[field]
  if (at === undefined) throw new Error(`${field} is not a field of a view's uniform block`)
  return at
}

/** The name of a field of the block, as the union the compiler and the host are checked against: a
 *  typo is a type error, not a throw thrown mid-frame. */
export type FieldName = (typeof VIEW_FIELDS)[number]['name']

/** The stride must be a whole number of four-word units: WGSL lays a uniform array out with a
 *  sixteen-byte aligned stride, and a block of 65 words would fail at shader-compile time, on a
 *  device, rather than here. */
if (VIEW_BLOCK_WORDS % 4 !== 0)
  throw new Error(`a view's uniform block is ${VIEW_BLOCK_WORDS} words, not a multiple of four`)

/** The WGSL struct the kernels bind, built from the same table the host writes against. */
export const VIEW_UNIFORM_STRUCT = `struct Uniforms{${VIEW_FIELDS.map(
  (field) => `${field.name}:${field.type}`,
).join(',')},}`
