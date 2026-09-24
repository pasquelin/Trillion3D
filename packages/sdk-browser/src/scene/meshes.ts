import type {
  HostGraphGeometry,
  HostGraphMaterial,
  HostGraphTexture,
} from '../host/scene/graphResources.ts';
import type { HostGraphMesh, HostGraphNode } from '../host/scene/graphNodes.ts';
import { isDrawnNode } from '../host/graph/kinds.ts';
import { isGraphTexture } from '../host/graph/texture.ts';

/** Meshes of a subtree, in preorder. Nothing is lifted here: the world matrices the
 *  engine needs are its own (`../host/world/placements.ts`), and the host scene stays as it left it. */
export function meshes(node: HostGraphNode) {
  const found: HostGraphMesh[] = [];
  node.traverse((object) => {
    if (isDrawnNode(object)) found.push(object);
  });
  return found;
}
/** The textures a host material carries, whatever their slot: what its renderer would sample. */
export function* materialTextures(material: HostGraphMaterial): Generator<HostGraphTexture> {
  for (const value of Object.values(material)) if (isGraphTexture(value)) yield value;
}
export function geometryBytes(geometry: HostGraphGeometry, seen: Set<ArrayBufferView>) {
  let bytes = 0;
  const index = geometry.index;
  if (index && !seen.has(index.array)) {
    seen.add(index.array);
    bytes += index.array.byteLength;
  }
  for (const name in geometry.attributes) {
    const attr = geometry.attributes[name];
    if (!attr || seen.has(attr.array)) continue;
    seen.add(attr.array);
    bytes += attr.array.byteLength;
  }
  return bytes;
}
