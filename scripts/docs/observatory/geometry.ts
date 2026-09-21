/** One material's authored surface: interleaved position/normal streams and triangle indices. */
export interface SurfaceMesh {
  positions: number[];
  normals: number[];
  indices: number[];
}

/** Original parametric masonry, turned stone and metalwork, in metres. */
export function createWorkshop() {
  const surfaces = new Map<number, SurfaceMesh>();
  function patch(
    material: number,
    columns: number,
    rows: number,
    point: (u: number, v: number) => number[],
  ) {
    let mesh = surfaces.get(material);
    if (!mesh) {
      mesh = { positions: [], normals: [], indices: [] };
      surfaces.set(material, mesh);
    }
    const base = mesh.positions.length / 3;
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
  function block(material: number, center: number[], size: number[]) {
    for (let axis = 0; axis < 3; axis++)
      for (const sign of [-1, 1]) {
        const a = (axis + 1) % 3,
          b = (axis + 2) % 3;
        patch(material, 1, 1, (u, v) => {
          const p = [...center];
          p[axis] += (sign * size[axis]) / 2;
          p[a] += sign * (u - 0.5) * size[a];
          p[b] += (v - 0.5) * size[b];
          return p;
        });
      }
  }
  function turned(
    material: number,
    center: number[],
    radius: number,
    height: number,
    flutes = 0,
    segments = 64,
  ) {
    patch(material, segments, 24, (u, v) => {
      const angle = u * Math.PI * 2;
      const profile = radius * (1 - 0.12 * v + 0.035 * Math.sin(v * Math.PI));
      const r = profile * (1 + (flutes ? 0.06 * Math.cos(angle * flutes) : 0));
      return [
        center[0] + r * Math.cos(angle),
        center[1] + v * height,
        center[2] - r * Math.sin(angle),
      ];
    });
  }
  function ring(
    material: number,
    center: number[],
    radius: number,
    tube: number,
    tilt = 0,
    sweep = Math.PI * 2,
  ) {
    patch(material, 96, 16, (u, v) => {
      const a = u * sweep,
        b = v * Math.PI * 2;
      const x = (radius + tube * Math.cos(b)) * Math.cos(a);
      const y = (radius + tube * Math.cos(b)) * Math.sin(a);
      const z = tube * Math.sin(b);
      return [
        center[0] + x,
        center[1] + y * Math.cos(tilt) - z * Math.sin(tilt),
        center[2] + y * Math.sin(tilt) + z * Math.cos(tilt),
      ];
    });
  }
  return { surfaces, patch, block, turned, ring };
}
