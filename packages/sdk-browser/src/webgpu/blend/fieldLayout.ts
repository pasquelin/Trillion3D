/** A struct field's WGSL type: its words, and its alignment in words (WGSL's struct rules). */
const TYPES = {
  f32: [1, 1],
  u32: [1, 1],
  vec2f: [2, 2],
  vec3f: [3, 4],
  vec4f: [4, 4],
  mat4x4f: [16, 4],
} as const

/** A struct's fields in one table, in order: each its name and its WGSL type. */
type FieldTable = readonly (readonly [string, keyof typeof TYPES])[]

/**
 * What a struct's field table yields, so the shader and the writer cannot drift apart: each
 * field's first word, laid out as WGSL lays the struct out, the struct's words, rounded to its
 * widest alignment, and its WGSL declaration, named `name`.
 */
export function fieldLayout<T extends FieldTable>(name: string, table: T) {
  const at = {} as Record<T[number][0], number>
  let end = 0,
    align = 1
  for (const [field, type] of table) {
    const [words, alignment] = TYPES[type]
    end = Math.ceil(end / alignment) * alignment
    at[field as T[number][0]] = end
    end += words
    align = Math.max(align, alignment)
  }
  const wgsl = `struct ${name}{${table.map(([field, type]) => `${field}:${type},`).join('')}}`
  return { at: at as Readonly<typeof at>, words: Math.ceil(end / align) * align, wgsl }
}
