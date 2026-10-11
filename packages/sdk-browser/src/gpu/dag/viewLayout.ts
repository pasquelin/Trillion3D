import { fieldLayout } from '../core/fieldLayout.ts'

/**
 * One view's uniform block, described once.
 *
 * The kernels read the block through a WGSL `struct`, and the host fills it by word: `writeDagUniforms`
 * wrote `target[42]` and `ints[54]` against a struct that named every field. Nothing tied the two
 * together, so a field added to one side and not the other would move every word after it and the
 * kernels would read the wrong numbers — a silent image change, not a type error.
 *
 * So the field table below is the only description of the block. `fieldLayout` makes of it the WGSL
 * struct text (`VIEW_UNIFORM_STRUCT`) and the word offsets the host writes. Adding a field means
 * adding one line here, and both sides follow. Offsets follow WGSL's own layout rules; the `vec3`
 * rule is the one that bites: `cameraWorld` is twelve bytes yet cannot start at word 47, it waits
 * for word 48.
 */
/** The block, in order. `as const` is what makes `FieldName` a union of the field names rather
 *  than `string`: a typo in `viewWord` is then a type error, not a throw mid-frame. */
const VIEW_FIELDS = [
  ['planes', 'array<vec4f,6>'],
  ['view', 'mat4x4f'],
  ['pixelScale', 'vec2f'],
  ['pixelError', 'f32'],
  ['near', 'f32'],
  ['clusterCount', 'u32'],
  ['nodeCount', 'u32'],
  ['worldCount', 'u32'],
  ['cameraWorld', 'vec3f'],
  ['cameraStretch', 'f32'],
  ['listCap', 'u32'],
  ['perspective', 'f32'],
  ['viewCount', 'u32'],
  ['viewCapacity', 'u32'],
  ['queueCap', 'u32'],
  ['ahead', 'u32'],
  ['admitByLevel', 'u32'],
  ['swapRegions', 'u32'],
  ['worldRoot', 'u32'],
  ['treeTop', 'u32'],
  ['cellBase', 'u32'],
  ['members', 'u32'],
  ['worldLinks', 'u32'],
  ['worldScale', 'f32'],
  // The open counts placements hold of their own (\`heldOpen.ts\`): the first word of their table in
  // \`out.pages\`, and its slots less one.
  ['heldBase', 'u32'],
  ['heldMask', 'u32'],
  // The candidates and the live list hold \`candCap\` entries each (\`shader/levelWgsl.ts\`); the
  // cold table's unique records and content keys (\`layout.ts\`).
  ['candCap', 'u32'],
  ['recordCount', 'u32'],
  ['keyCount', 'u32'],
  ['lightOriginHigh', 'vec4f'],
  ['lightOriginLow', 'vec4f'],
  ['lightPlanes', 'array<vec4f,6>'],
  // The eye the cut reads its translations at, \`cameraWorld\` in doubles, high word then low word
  // (\`shader/worldPoseWgsl.ts\`): x and y in the first, z in the second.
  ['eye', 'array<vec4u,2>'],
] as const

const LAYOUT = fieldLayout('Uniforms', VIEW_FIELDS)

/** Words one view's block holds: the stride of the uniform array, and the size the host allocates. */
export const VIEW_BLOCK_WORDS = LAYOUT.words

/** The word a field starts at. `viewWord('ahead')` is where the host writes what the kernels read
 *  as `views[vi].ahead`; nothing else may hold that number. */
export const viewWord = (field: FieldName): number => {
  const at: number | undefined = LAYOUT.at[field]
  if (at === undefined) throw new Error(`${field} is not a field of a view's uniform block`)
  return at
}

/** The name of a field of the block, as the union the compiler and the host are checked against. */
export type FieldName = (typeof VIEW_FIELDS)[number][0]

/** The WGSL struct the kernels bind, built from the same table the host writes against. */
export const VIEW_UNIFORM_STRUCT = LAYOUT.wgsl
