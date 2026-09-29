import { FLAG_MORPH, FLAG_SKIN, OPTIONAL } from '../../cluster/format.ts';

/**
 * The block a decoded page occupies, whichever decoder produced it: the 32-bit indices, then the
 * floats of each attribute in stream order — position, then the optional attributes the flags
 * name, then a skin's joints and weights and the morph targets' displacements (#357). One
 * buffer, so a page crosses a thread or the WebAssembly boundary whole.
 */
/** Float width of each decoded attribute, by its name; `morph` is six per target. */
const WIDTH: Record<string, number> = { position: 3, skinIndex: 4, skinWeight: 4, morph: 6 };
for (const [name, width] of OPTIONAL) WIDTH[name] = width;

/** The attribute names a page with `flags` decodes, in write order. */
export function pageAttributeNames(flags: number): string[] {
  const optional = OPTIONAL.filter(([, , bit]) => flags & bit).map(([name]) => name);
  const skin = flags & FLAG_SKIN ? ['skinIndex', 'skinWeight'] : [];
  return ['position', ...optional, ...skin, ...(flags & FLAG_MORPH ? ['morph'] : [])];
}

/** Floats per vertex of `names` with `targets` morph targets. */
const floatsOf = (names: readonly string[], targets: number) =>
  names.reduce((sum, name) => sum + WIDTH[name] * (name === 'morph' ? targets : 1), 0);

/** The morph targets a decoded block of `bytes` holds, from its counts: what the WebAssembly
 *  result block does not say itself. */
export const morphTargetsOf = (
  bytes: number,
  names: readonly string[],
  vertexCount: number,
  indexCount: number,
) =>
  names.includes('morph')
    ? ((bytes - indexCount * 4) / (vertexCount * 4) - floatsOf(names, 0)) / 6
    : 0;

/** Views on a decoded block: the indices fill what `vertexCount` vertices of `names` leave. */
export function pageViews(
  block: ArrayBuffer,
  names: readonly string[],
  vertexCount: number,
  targets = 0,
) {
  const floats = floatsOf(names, targets);
  const indices = new Uint32Array(block, 0, (block.byteLength - vertexCount * floats * 4) / 4);
  const attributes: Record<string, Float32Array<ArrayBuffer>> = {};
  let cursor = indices.byteLength;
  for (const name of names) {
    const width = WIDTH[name] * (name === 'morph' ? targets : 1);
    attributes[name] = new Float32Array(block, cursor, vertexCount * width);
    cursor += attributes[name].byteLength;
  }
  return { indices, attributes };
}
