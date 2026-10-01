import { box } from '../world/geometry/basic.ts';
import { Mesh } from '../world/object/mesh.ts';

/** An axis-aligned solid between two world-space corners. */
export function block(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const mesh = new Mesh(box(x1 - x0, y1 - y0, z1 - z0));
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return mesh;
}

