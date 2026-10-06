import { FLAG_MORPH, FLAG_SKIN, OPTIONAL } from '../../cluster/format.ts'

/**
 * The block a decoded page occupies, whichever decoder produced it: the 32-bit indices, then the
 * floats of each attribute in stream order — position, then the optional attributes the flags
 * name, then a skin's joints and weights and the morph targets' displacements (#357). One
 * buffer, so a page crosses a thread or the WebAssembly boundary whole.
 */
/** Float width of each decoded attribute, by its name; `morph` is six per target. */
const WIDTH: Record<string, number> = { position: 3, morph: 6 }
for (const [name, width] of OPTIONAL) WIDTH[name] = width
/** Floats per vertex of attribute `name`: a skin stream holds `influences`, the morphs `targets`. */
const widthOf = (name: string, targets: number, influences: number) =>
  (name.startsWith('skin') ? influences : WIDTH[name]) * (name === 'morph' ? targets : 1)

/** The attribute names a page with `flags` decodes, in write order. */
export function pageAttributeNames(flags: number): string[] {
  const optional = OPTIONAL.filter(([, , bit]) => flags & bit).map(([name]) => name)
  const skin = flags & FLAG_SKIN ? ['skinIndex', 'skinWeight'] : []
  return ['position', ...optional, ...skin, ...(flags & FLAG_MORPH ? ['morph'] : [])]
}

/** Floats per vertex of `names` with `targets` morph targets. */
const floatsOf = (names: readonly string[], targets: number, influences = 4) =>
  names.reduce((sum, name) => sum + widthOf(name, targets, influences), 0)

/** The morph targets a decoded block of `bytes` holds, from its counts: what the WebAssembly
 *  result block does not say itself. */
export const morphTargetsOf = (
  bytes: number,
  names: readonly string[],
  vertexCount: number,
  indexCount: number,
  influences = 4,
) =>
  names.includes('morph')
    ? ((bytes - indexCount * 4) / (vertexCount * 4) - floatsOf(names, 0, influences)) / 6
    : 0

/** Views on a decoded block: the indices fill what `vertexCount` vertices of `names` leave. */
export function pageViews(
  block: ArrayBuffer,
  names: readonly string[],
  vertexCount: number,
  targets = 0,
  influences = 4,
) {
  const floats = floatsOf(names, targets, influences)
  const indices = new Uint32Array(block, 0, (block.byteLength - vertexCount * floats * 4) / 4)
  const attributes: Record<string, Float32Array<ArrayBuffer>> = {}
  let cursor = indices.byteLength
  for (const name of names) {
    attributes[name] = new Float32Array(
      block,
      cursor,
      vertexCount * widthOf(name, targets, influences),
    )
    cursor += attributes[name].byteLength
  }
  return { indices, attributes }
}
