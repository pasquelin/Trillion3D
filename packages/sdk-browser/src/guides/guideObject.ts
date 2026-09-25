import { invertMatrix4, multiplyMatrix4 } from '../../../sdk-core/src/index.ts';
import { lineCorners } from '../../../sdk-core/src/world/geometry/drawn.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import type { Material } from '../../../sdk-core/src/world/material/material.ts';

/** Segments of one colour and width, two ends of three numbers each; a point is a segment whose
 *  two ends are the same. `vertices` is what the ceiling counts: two per segment, one per point. */
export interface GuidePiece {
  ends: Float64Array;
  color: number;
  width: number;
  vertices: number;
}

const inverse = new Float64Array(16),
  local = new Float64Array(16);

/**
 * What `guides.add` draws of `object`: one piece per line or point mesh of its subtree, its
 * positions in `object`'s own frame (the mesh's pose relative to it applied), in the colour of
 * its first material. `lineCorners` reads its segments as the scene path reads them.
 */
export function objectPieces(object: Object3D, width: number, size: number): GuidePiece[] {
  invertMatrix4(inverse, object.matrixWorld.elements);
  const pieces: GuidePiece[] = [];
  object.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || mesh.primitive === 'triangles' || mesh.primitive === 'sprite') return;
    const position = mesh.geometry.attributes.position;
    if (!position?.count) return;
    multiplyMatrix4(local, inverse, mesh.matrixWorld.elements);
    const corners = mesh.geometry.index
      ? Array.from(mesh.geometry.index.array)
      : Array.from({ length: position.count }, (_, i) => i);
    const points = mesh.primitive === 'points';
    const pairs = points ? corners.flatMap((c) => [c, c]) : lineCorners(corners, mesh.primitive);
    const ends = new Float64Array(pairs.length * 3);
    pairs.forEach((v, k) => {
      const [x, y, z] = [position.getX(v), position.getY(v), position.getZ(v)];
      for (let c = 0; c < 3; c++)
        ends[k * 3 + c] = local[c] * x + local[4 + c] * y + local[8 + c] * z + local[12 + c];
    });
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material;
    pieces.push({
      ends,
      color: material.color.getHex(),
      width: points ? size : width,
      vertices: points ? pairs.length / 2 : pairs.length,
    });
  });
  return pieces;
}
