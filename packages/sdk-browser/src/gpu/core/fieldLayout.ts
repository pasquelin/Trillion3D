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
 * widest alignment, that alignment, and its WGSL declaration, named `name`.
 */
export function fieldLayout<T extends FieldTable>(name: string, table: T) {
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
    .join('')}}`
  return { name, at: at as Readonly<typeof at>, words: alignUp(end, align), align, wgsl }
}

/** The field type of `count` records of the struct `of` lays out: WGSL strides an array of a
 *  struct by the struct's words, already rounded to its alignment. */
export function arrayOf(of: ReturnType<typeof fieldLayout>, count: number): FieldType {
  return { wgsl: `array<${of.name},${count}>`, words: of.words * count, align: of.align }
}
