import type { Primitive } from '../sdk-core/src/index.ts';

/**
 * Manifest primitives looked up by their mesh association. A `find` per mesh walked the whole
 * manifest: loading a scene with N primitives paid N². The first primitive of a key wins,
 * like `find`; a NaN key finds nothing, like `===`.
 */
export function primitiveFinder(primitives: readonly Primitive[]) {
  const byMesh = new Map<unknown, Map<unknown, Primitive>>();
  for (const item of primitives) {
    if (Number.isNaN(item.mesh) || Number.isNaN(item.primitive)) continue;
    let byPrimitive = byMesh.get(item.mesh);
    if (!byPrimitive) byMesh.set(item.mesh, (byPrimitive = new Map()));
    if (!byPrimitive.has(item.primitive)) byPrimitive.set(item.primitive, item);
  }
  return (association: { meshes?: number; primitives?: number } | undefined) => {
    const mesh = association?.meshes,
      primitive = association?.primitives ?? 0;
    if (Number.isNaN(mesh) || Number.isNaN(primitive)) return undefined;
    return byMesh.get(mesh)?.get(primitive);
  };
}
