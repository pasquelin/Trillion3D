/**
 * The roughest and smoothest surfaces a frame shades, read from the host graph the world draws
 * (#958): the real roughness a lamp's reach is bounded at, never the pathological
 * `ROUGHNESS_FLOOR` reflector no scene holds. Every host mesh wears one surface or a list
 * (`worldMirror.ts`), and a page's own meshes wear `Material`s; both expose `roughness` as a
 * number, so the walk reads either without knowing the class.
 */
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/** What a drawn node wears: one material, or one per group, each with an optional roughness. */
type Wearer = { material?: { roughness?: unknown } | { roughness?: unknown }[] };

/** The least `roughness` any drawn surface declares below `root`, or `undefined` when none does —
 *  the caller then bounds at `ROUGHNESS_FLOOR`, the conservative end. */
export function minimumRoughness(root: Object3D): number | undefined {
  let least = Infinity;
  const read = (material?: { roughness?: unknown }) => {
    const value = material?.roughness;
    if (typeof value === 'number' && Number.isFinite(value)) least = Math.min(least, value);
  };
  root.traverse((node) => {
    const worn = (node as unknown as Wearer).material;
    if (Array.isArray(worn)) worn.forEach(read);
    else read(worn);
  });
  return least === Infinity ? undefined : least;
}
