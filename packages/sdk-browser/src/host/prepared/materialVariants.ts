import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts';
import type { TablePrimitive } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { HostMesh } from '../resources.ts';
import type { GraphSurface } from '../graph/surface.ts';
import type { SurfaceVariant } from './materials.ts';

export type VariantGroup = { id: string; names: readonly string[] };
export type PreparedVariants = {
  group: VariantGroup;
  original: GraphSurface;
  surfaces: ReadonlyMap<number, GraphSurface>;
};
const held = new WeakMap<object, PreparedVariants>();
export const preparedVariantsOf = (mesh: object) => held.get(mesh);
export function copyPreparedVariants(from: object, to: object) {
  const variants = held.get(from);
  if (variants) held.set(to, variants);
}
export function variantMesh<T extends Object3D>(mesh: T, prepared: PreparedVariants): T {
  if (prepared.group.names.length) held.set(mesh, prepared);
  return mesh;
}

/** Every declared alternate uses the same material/texture builder as the default surface. */
export function primitiveMaterials(
  group: VariantGroup,
  primitive: TablePrimitive,
  variant: SurfaceVariant,
  materialOf: (rank: number, variant: SurfaceVariant) => Promise<GraphSurface>,
) {
  const bindings = primitive.variants ?? [];
  if (!Array.isArray(bindings))
    throw new EngineError('INVALID_SCENE_TABLES', 'Material variant bindings must be an array');
  const seen = new Set<number>();
  for (const binding of bindings) {
    if (
      !binding ||
      !Number.isSafeInteger(binding.variant) ||
      binding.variant < 0 ||
      binding.variant >= group.names.length ||
      seen.has(binding.variant) ||
      !Number.isSafeInteger(binding.material) ||
      binding.material < 0
    )
      throw new EngineError('INVALID_SCENE_TABLES', 'Invalid material variant binding');
    seen.add(binding.variant);
  }
  return Promise.all([
    materialOf(primitive.material, variant),
    ...bindings.map((binding) => materialOf(binding.material, variant)),
  ]).then(([original, ...surfaces]): PreparedVariants => ({
    group,
    original,
    surfaces: new Map(bindings.map((binding, i) => [binding.variant, surfaces[i]])),
  }));
}

/** Original and alternate surfaces, so the existing material API can edit either in place. */
export function variantSurfaces(mesh: HostMesh): GraphSurface[] {
  const variants = held.get(mesh);
  return variants ? [variants.original, ...variants.surfaces.values()] : [];
}
