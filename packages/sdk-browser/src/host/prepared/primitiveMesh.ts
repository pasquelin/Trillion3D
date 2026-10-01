import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import type { TablePrimitive } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import { numbered } from '../graph/serial.ts';
import { variantMesh, type PreparedVariants } from './materialVariants.ts';
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts';

/** Keep imported line topology explicit; its vertices enter the world line cutter. */
export function primitiveMesh(
  geometry: Geometry,
  surfaces: PreparedVariants,
  part: TablePrimitive,
) {
  if (part.mode !== undefined && ![1, 2, 3].includes(part.mode))
    throw new EngineError('INVALID_SCENE_TABLES', 'Unsupported primitive mode');
  const primitive =
    part.mode === 1
      ? 'lineSegments'
      : part.mode === 2
        ? 'lineLoop'
        : part.mode === 3
          ? 'lineStrip'
          : 'triangles';
  return variantMesh(numbered(new Mesh(geometry, surfaces.original, primitive)), surfaces);
}

export const referenceCounts = (
  tables: PreparedSceneTables,
  field: 'mesh' | 'light' | 'camera',
) => {
  const counts = new Map<number, number>();
  for (const node of tables.nodes)
    if (node[field] !== null) counts.set(node[field], (counts.get(node[field]) ?? 0) + 1);
  return counts;
};
