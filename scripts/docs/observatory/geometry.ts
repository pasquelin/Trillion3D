import { geometry, type Geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts';

/** One material's authored surface: interleaved position/normal streams and triangle indices. */
export interface SurfaceMesh {
  positions: number[];
  normals: number[];
  indices: number[];
}

/** One authored part: what built it and the box its vertices span, in metres. */
export interface Part {
  kind: 'block' | 'turned' | 'patch' | 'ring';
  min: number[];
  max: number[];
}

/** The height of a part's base, and of its top. */
export const bottom = (part: Part) => part.min[1];
export const top = (part: Part) => part.max[1];

/** Original parametric masonry, turned stone and metalwork, in metres; boxes and rings: sdk-core.
 *  Each part is recorded with its extent, so what rests on it is placed from it. */
export function createWorkshop() {
  const surfaces = new Map<number, SurfaceMesh>();
  const parts: Part[] = [];
  function surface(material: number) {
    let mesh = surfaces.get(material);
    if (!mesh) {
      mesh = { positions: [], normals: [], indices: [] };
      surfaces.set(material, mesh);
    }
    return mesh;
  }
  /** Records the part `build` appends to `material`'s surface, spanned by its new vertices. */
  function recorded(kind: Part['kind'], material: number, build: () => void) {
    const { positions } = surface(material),
      from = positions.length;
    build();
    const part: Part = {
      kind,
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    for (let i = from; i < positions.length; i++) {
      part.min[i % 3] = Math.min(part.min[i % 3], positions[i]);
      part.max[i % 3] = Math.max(part.max[i % 3], positions[i]);
    }
    parts.push(part);
    return part;
  }
  function grid(
    material: number,
    columns: number,
    rows: number,
    point: (u: number, v: number) => number[],
  ) {
    const mesh = surface(material),
      base = mesh.positions.length / 3;
    /** The surface's normal at (u, v), or null where one tangent vanishes against the other. */
    const normal = (u: number, v: number) => {
      const p = point(u, v);
      const du = point(u + 0.00001, v).map((x, k) => x - p[k]);
      const dv = point(u, v + 0.00001).map((x, k) => x - p[k]);
      const n = [
        du[1] * dv[2] - du[2] * dv[1],
        du[2] * dv[0] - du[0] * dv[2],
        du[0] * dv[1] - du[1] * dv[0],
      ];
      const length = Math.hypot(...n);
      return length > 1e-6 * (Math.hypot(...du) ** 2 + Math.hypot(...dv) ** 2)
        ? n.map((x) => x / length)
        : null;
    };
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= columns; i++) {
        const u = i / columns,
          v = j / rows;
        // At a pole every column meets in one point and the row has no tangent: the normal there
        // is the one a hair inside the surface.
        mesh.positions.push(...point(u, v));
        mesh.normals.push(...(normal(u, v) ?? normal(u, v < 0.5 ? v + 0.001 : v - 0.001)!));
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
  const patch = (
    material: number,
    columns: number,
    rows: number,
    point: (u: number, v: number) => number[],
  ) => recorded('patch', material, () => grid(material, columns, rows, point));
  const block = (material: number, center: number[], size: number[]) =>
    recorded('block', material, () =>
      add(
        material,
        geometry.box(size[0], size[1], size[2]).translate(center[0], center[1], center[2]),
      ),
    );
  /** A turned part standing on `base`, the centre of its foot. */
  function turned(
    material: number,
    base: number[],
    radius: number,
    height: number,
    flutes = 0,
    segments = 64,
  ) {
    const profile = (v: number) => radius * (1 - 0.12 * v + 0.035 * Math.sin(v * Math.PI));
    return recorded('turned', material, () => {
      if (!flutes) {
        const points = Array.from(
          { length: 25 },
          (_, j) => [profile(j / 24), (j / 24) * height] as const,
        );
        add(material, geometry.lathe(points, segments).translate(base[0], base[1], base[2]));
        return;
      }
      // Flutes ripple the radius round the shaft, which a lathe profile cannot carry.
      grid(material, segments, 24, (u, v) => {
        const angle = u * Math.PI * 2;
        const r = profile(v) * (1 + 0.06 * Math.cos(angle * flutes));
        return [base[0] + r * Math.cos(angle), base[1] + v * height, base[2] - r * Math.sin(angle)];
      });
    });
  }
  /** A full ring about `z`, tilted `tilt` about `x`. */
  const ring = (material: number, center: number[], radius: number, tube: number, tilt = 0) =>
    recorded('ring', material, () =>
      add(
        material,
        geometry
          .torus(radius, tube, 16, 96)
          .rotateX(tilt)
          .translate(center[0], center[1], center[2]),
      ),
    );
  return { surfaces, parts, patch, block, turned, ring };
}
