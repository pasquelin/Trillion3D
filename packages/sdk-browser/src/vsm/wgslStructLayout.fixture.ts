import { alignUp } from '../../../math/src/scalar/integers.ts'
import { type WgslSource, wgslSource } from '../../../math/src/wgsl/source.fixture.ts'
import { withoutComments } from '../../../math/src/wgsl/comments.fixture.ts'

/** The memory layout of a WGSL struct, computed from its source text by WGSL's layout rules. */
export interface WgslStructLayout {
  /** The byte offset of each field. */
  offsets: Record<string, number>
  /** The struct's size, rounded up to its alignment. */
  size: number
  align: number
}

/** The size and alignment of a type: the scalars, `vecN` (`vec3f`, `vec4u`, `vec2<f32>`, ...), `mat4x4f`, `array<T,n>`. */
function shapeOf(type: string): [size: number, align: number] {
  if (/^(?:f32|u32|i32)$/.test(type)) return [4, 4]
  const vec = /^vec([234])(?:[fui]|<(?:f32|u32|i32)>)$/.exec(type)
  if (vec) {
    const n = Number(vec[1])
    return [4 * n, n === 2 ? 8 : 16]
  }
  if (/^mat4x4(?:f|<f32>)$/.test(type)) return [64, 16]
  const array = /^array<(.+),(\d+)>$/.exec(type)
  if (array) {
    const [size, align] = shapeOf(array[1])
    return [alignUp(size, align) * Number(array[2]), align]
  }
  throw new Error(`wgslStructLayout: no layout rule for type ${type}`)
}

/** Splits at the commas outside any `<...>`. */
function fields(body: string): string[] {
  const out: string[] = []
  let depth = 0,
    from = 0
  for (let k = 0; k < body.length; k++) {
    const c = body[k]
    if (c === '<') depth++
    else if (c === '>') depth--
    else if (c === ',' && depth === 0) {
      out.push(body.slice(from, k))
      from = k + 1
    }
  }
  out.push(body.slice(from))
  return out.map((f) => f.trim()).filter((f) => f !== '')
}

/** The layout of `struct <name>{...}` in `src`; throws when the struct or a field's type is unknown. */
export function wgslStructLayout(input: WgslSource, name: string): WgslStructLayout {
  const src = wgslSource(input)
  const text = withoutComments(src)
  const start = new RegExp(`struct\\s+${name}\\s*\\{`).exec(text)
  if (!start) throw new Error(`wgslStructLayout: no struct ${name}`)
  const from = start.index + start[0].length
  const body = text.slice(from, text.indexOf('}', from))
  const offsets: Record<string, number> = {}
  let at = 0,
    align = 1
  for (const field of fields(body)) {
    const m = /^(\w+)\s*:\s*(.+)$/s.exec(field)
    if (!m) throw new Error(`wgslStructLayout: cannot read the field "${field}" of ${name}`)
    const [size, fieldAlign] = shapeOf(m[2].replace(/\s+/g, ''))
    at = alignUp(at, fieldAlign)
    offsets[m[1]] = at
    at += size
    align = Math.max(align, fieldAlign)
  }
  return { offsets, size: alignUp(at, align), align }
}
