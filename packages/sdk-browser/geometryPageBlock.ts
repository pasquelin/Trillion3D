import { OPTIONAL } from './clusterFormat.ts';

/**
 * The block a decoded page occupies, whichever decoder produced it: the 32-bit indices, then the
 * floats of each attribute in stream order — position, then the optional attributes the flags
 * name. One buffer, so a page crosses a thread or the WebAssembly boundary whole.
 */
/** Float width of each decoded attribute, by its name. */
const WIDTH: Record<string, number> = { position: 3 };
for (const [name, width] of OPTIONAL) WIDTH[name] = width;

/** The attribute names a page with `flags` decodes, in write order. */
export function pageAttributeNames(flags: number): string[] {
  return ['position', ...OPTIONAL.filter(([, , bit]) => flags & bit).map(([name]) => name)];
}

/** Views on a decoded block: the indices fill what `vertexCount` vertices of `names` leave. */
export function pageViews(block: ArrayBuffer, names: readonly string[], vertexCount: number) {
  let floats = 0;
  for (const name of names) floats += WIDTH[name];
  const indices = new Uint32Array(block, 0, (block.byteLength - vertexCount * floats * 4) / 4);
  const attributes: Record<string, Float32Array<ArrayBuffer>> = {};
  let cursor = indices.byteLength;
  for (const name of names) {
    attributes[name] = new Float32Array(block, cursor, vertexCount * WIDTH[name]);
    cursor += attributes[name].byteLength;
  }
  return { indices, attributes };
}
