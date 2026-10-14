import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { fieldStart, type RecordLayout } from './recordLayout.ts'

/** How a program binds a record table (`recordTexture.ts`): sampled and read, written alone by a
 *  storage texture, or read and written by one (the WGSL feature
 *  `readonly_and_readwrite_storage_textures`). */
export type RecordAccess = 'read' | 'write' | 'read_write'

/** Where a program binds a record table, under which WGSL name, and how. */
export type RecordBinding = { name: string; group: number; binding: number; access: RecordAccess }

/** The scalar a texel of `layout` reads as. */
const sampled = (layout: RecordLayout) => (layout.format === 'r32float' ? 'f32' : 'u32')

/** The type a program declares the table with. */
function declared(layout: RecordLayout, access: RecordAccess) {
  if (access === 'read') return `texture_2d_array<${sampled(layout)}>`
  return `texture_storage_2d_array<${layout.format},${access}>`
}

/** Where texel `k` of field `field` of record `r` lies: `x`, its column, declared, then `at`, the
 *  coordinates and layer a load or a store takes — the layout's shifts and masks, four integer
 *  operations a texel. */
export function recordTexelWgsl(layout: RecordLayout, field: string) {
  const per = 1 << layout.rowShift,
    rowMask = (1 << layout.layerShift) - 1,
    shift = layout.rowShift + layout.layerShift
  return {
    x: `let x=${fieldStart(layout, field)}u+(r&${per - 1}u)*${layout.fields[field]}u+k;`,
    at: `vec2u(x,(r>>${layout.rowShift}u)&${rowMask}u),r>>${shift}u`,
  }
}

/**
 * A record table as a program reads or writes it: its declaration and, for each field `F` of the
 * layout, `<name>F(r,k)` — texel `k` of the field of record `r`, a `vec4u` (an `r32uint` word in
 * `x`; a `vec4f` of an `r32float` table) — where the program reads it, and `<name>FStore(r,k,v)`
 * where it writes it, at `recordTexelWgsl`.
 */
export function recordTextureWgsl(
  layout: RecordLayout,
  { name, group, binding, access }: RecordBinding,
) {
  const vec = `vec4${sampled(layout) === 'f32' ? 'f' : 'u'}`
  const fns = Object.keys(layout.fields).map((field) => {
    const { x, at } = recordTexelWgsl(layout, field)
    const read =
      access === 'write'
        ? ''
        : `fn ${name}${field}(r:u32,k:u32)->${vec}{${x}return textureLoad(${name},${at}${access === 'read' ? ',0' : ''});}`
    const store =
      access === 'read'
        ? ''
        : `fn ${name}${field}Store(r:u32,k:u32,v:${vec}){${x}textureStore(${name},${at},v);}`
    return read + store
  })
  return wgslBlock(
    `recordTexture(${layout.label}, ${name}, ${group}, ${binding}, ${access})`,
    [],
    `@group(${group}) @binding(${binding}) var ${name}:${declared(layout, access)};
${fns.join('\n')}`,
  )
}
