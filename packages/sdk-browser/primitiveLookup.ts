import type { Primitive } from '../sdk-core/index.ts';

/**
 * Les primitives du manifeste retrouvées par leur association de maillage. Un `find` par maillage
 * parcourait tout le manifeste : le chargement d'une scène à N primitives en payait N². La première
 * primitive d'une clé l'emporte, comme `find` ; une clé NaN ne trouve rien, comme `===`.
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
