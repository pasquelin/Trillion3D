import { geometry, type Geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts';

/** One material's authored surface: interleaved position/normal streams and triangle indices. */
export interface SurfaceMesh {
  positions: number[];
  normals: number[];
  indices: number[];
}

/** One authored box: its centre and size, in metres. */
export interface Block {
  center: number[];
  size: number[];
}

/** Original parametric masonry, turned stone and metalwork, in metres; boxes and rings: sdk-core. */
export function createWorkshop() {
  const surfaces = new Map<number, SurfaceMesh>();
  const blocks: Block[] = [];
  function surface(material: number) {
    let mesh = surfaces.get(material);
    if (!mesh) {
      mesh = { positions: [], normals: [], indices: [] };
      surfaces.set(material, mesh);
    }
    return mesh;
  }
  function patch(
    material: number,
    columns: number,
    rows: number,
    point: (u: number, v: number) => number[],
  ) {
    const mesh = surface(material),
      base = mesh.positions.length / 3;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= columns; i++) {
        const u = i / columns,
          v = j / rows,
          p = point(u, v);
        const du = point(u + 0.00001, v).map((x, k) => x - p[k]);
        const dv = point(u, v + 0.00001).map((x, k) => x - p[k]);
        const normal = [
          du[1] * dv[2] - du[2] * dv[1],
          du[2] * dv[0] - du[0] * dv[2],
          du[0] * dv[1] - du[1] * dv[0],
        ];
        const length = Math.hypot(...normal) || 1;
        mesh.positions.push(...p);
        mesh.normals.push(...normal.map((x) => x / length));
      }
    }
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < columns; i++) {
        const a = base + j * (columns + 1) + i,
          b = a + columns + 1;
        mesh.indices.push(a, a + 1, b + 1, a, b + 1, b);
      }
  }
  /** An sdk-core geometry appended to one material's surface. */
  function add(material: number, built: Geometry) {
    const mesh = surface(material),
      base = mesh.positions.length / 3,
      { position, normal } = built.attributes;
    for (const value of position.array) mesh.positions.push(value);
    for (const value of normal.array) mesh.normals.push(value);
    for (const index of built.index!.array) mesh.indices.push(base + index);
  }
  function block(material: number, center: number[], size: number[]) {
    const [width, height, depth] = size;
    blocks.push({ center, size });
    add(material, geometry.box(width, height, depth).translate(center[0], center[1], center[2]));
  }
  function turned(
    material: number,
    center: number[],
    radius: number,
    height: number,
    flutes = 0,
    segments = 64,
  ) {
    const profile = (v: number) => radius * (1 - 0.12 * v + 0.035 * Math.sin(v * Math.PI));
    if (!flutes) {
      const points = Array.from(
        { length: 25 },
        (_, j) => [profile(j / 24), (j / 24) * height] as const,
      );
      add(material, geometry.lathe(points, segments).translate(center[0], center[1], center[2]));
      return;
    }
    // Flutes ripple the radius round the shaft, which a lathe profile cannot carry.
    patch(material, segments, 24, (u, v) => {
      const angle = u * Math.PI * 2;
      const r = profile(v) * (1 + 0.06 * Math.cos(angle * flutes));
      return [
        center[0] + r * Math.cos(angle),
        center[1] + v * height,
        center[2] - r * Math.sin(angle),
      ];
    });
  }
  /** A full ring about `z`, tilted `tilt` about `x`. */
  function ring(material: number, center: number[], radius: number, tube: number, tilt = 0) {
    add(
      material,
      geometry.torus(radius, tube, 16, 96).rotateX(tilt).translate(center[0], center[1], center[2]),
    );
  }
  return { surfaces, blocks, patch, block, turned, ring };
}
