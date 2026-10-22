import { alignUp } from '../../../../math/src/scalar/integers.ts'
/** A struct field's WGSL type: its words, and its alignment in words (WGSL's struct rules). */
const TYPES = {
  f32: [1, 1],
  u32: [1, 1],
  i32: [1, 1],
  vec2f: [2, 2],
  vec2u: [2, 2],
  vec2i: [2, 2],
  vec3f: [3, 4],
  vec4f: [4, 4],
  vec4u: [4, 4],
  vec4i: [4, 4],
  mat4x4f: [16, 4],
  'array<vec4f,6>': [24, 4],
  'array<vec4u,2>': [8, 4],
  'array<vec4f,3>': [12, 4],
} as const

/** A field's WGSL type spelled out: its declaration, its words and its alignment in words. */
export interface FieldType {
  readonly wgsl: string
  readonly words: number
  readonly align: number
}

/** A struct's fields in one table, in order: each its name and its WGSL type. */
type FieldTable = readonly (readonly [string, keyof typeof TYPES | FieldType])[]

/**
 * What a struct's field table yields, so the shader and the writer cannot drift apart: each
 * field's first word, laid out as WGSL lays the struct out, the struct's words, rounded to its
 * widest alignment, that alignment, and its WGSL declaration, named `name` — `tail` its last members
 * past the table's, a runtime-sized array a storage buffer's struct ends with.
 */
export function fieldLayout<T extends FieldTable>(name: string, table: T, tail = '') {
  const at = {} as Record<T[number][0], number>
  let end = 0,
    align = 1
  for (const [field, type] of table) {
    const [words, alignment] = typeof type === 'string' ? TYPES[type] : [type.words, type.align]
    end = alignUp(end, alignment)
    at[field as T[number][0]] = end
    end += words
    align = Math.max(align, alignment)
  }
  const wgsl = `struct ${name}{${table
    .map(([field, type]) => `${field}:${typeof type === 'string' ? type : type.wgsl},`)
    .join('')}${tail}}`
  return { name, at: at as Readonly<typeof at>, words: alignUp(end, align), align, wgsl }
}

/** `count` `vec4f` of an array member: four words each, aligned to four. */
export const vec4Array = (count: number): FieldType => ({
  wgsl: `array<vec4f,${count}>`,
  words: 4 * count,
  align: 4,
})

/** Writes the four numbers `x, y, z, w` into `out` from its word `at`: the one way a frame's
 *  `vec4f` is written. */
export function putVec4(out: Float32Array, at: number, x: number, y = 0, z = 0, w = 0) {
  out[at] = x
  out[at + 1] = y
  out[at + 2] = z
  out[at + 3] = w
}

/** `count` words of a word array, as a flat record (a frame, a key record) lays them: no WGSL
 *  struct reads it, the layout alone does. */
export const u32Words = (count: number): FieldType => ({
  wgsl: `array<u32,${count}>`,
  words: count,
  align: 1,
})
/** `count` emulated doubles in a word array: two words each, on an even word
 *  (`math/src/wgsl/doubleWords.ts`). */
export const doubleWords = (count: number): FieldType => ({
  wgsl: `array<vec2u,${count}>`,
  words: 2 * count,
  align: 2,
})

/** The field type of `count` records of the struct `of` lays out: WGSL strides an array of a
 *  struct by the struct's words, already rounded to its alignment. */
export function arrayOf(
  of: { readonly name: string; readonly words: number; readonly align: number },
  count: number,
): FieldType {
  return { wgsl: `array<${of.name},${count}>`, words: of.words * count, align: of.align }
}
