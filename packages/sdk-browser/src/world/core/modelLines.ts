import { meshes, loadHostVertices } from '../../scene/meshes.ts';
import { lineMaterials, bindLineMaterials } from './importedLineMaterials.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { hasConditionalLine } from './conditionalLines.ts';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { GraphSurface } from '../../host/graph/surface.ts';

/** Imported lines enter the world's existing line cutter with their source geometry. */
export const isImportedLine = (node: Object3D): node is Mesh<GraphSurface> =>
  node instanceof Mesh && ['lineSegments', 'lineStrip', 'lineLoop'].includes(node.primitive);

export function carriedLine(node: Object3D): Object3D | null {
  if (!isImportedLine(node)) return null;
  const mesh = new Mesh(node.geometry, lineMaterials(node.material), node.primitive);
  bindLineMaterials(mesh, node);
  return hasConditionalLine(node.geometry) ? new Object3D().add(mesh) : mesh;
}

/** Load only carried lines before their first runtime cut; triangle pages remain lazy. */
export const loadModelLines = (source: Object3D) =>
  loadHostVertices(meshes(source).filter(isImportedLine));
