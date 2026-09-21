/** Small parametric mesh workshop for the original shadow-theatre model. A patch also records
 *  its (u, v) per vertex, for a writer whose materials read a map. */

export type Vec3 = readonly [number, number, number];

export interface Mesh {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export function theatreWorkshop() {
  const surfaces = new Map<number, Mesh>();
  const surface = (material: number): Mesh => {
    let mesh = surfaces.get(material);
    if (!mesh) {
      mesh = { positions: [], normals: [], uvs: [], indices: [] };
      surfaces.set(material, mesh);
    }
    return mesh;
  };
  function patch(
    material: number,
    columns: number,
    rows: number,
    sample: (u: number, v: number) => Vec3,
  ) {
    const mesh = surface(material),
      first = mesh.positions.length / 3;
    for (let y = 0; y <= rows; y++)
      for (let x = 0; x <= columns; x++) {
        const u = x / columns,
          v = y / rows,
          point = sample(u, v),
          du = sample(u + 1e-5, v).map((value, axis) => value - point[axis]),
          dv = sample(u, v + 1e-5).map((value, axis) => value - point[axis]),
          normal = [
            du[1] * dv[2] - du[2] * dv[1],
            du[2] * dv[0] - du[0] * dv[2],
            du[0] * dv[1] - du[1] * dv[0],
          ],
          length = Math.hypot(...normal) || 1;
        mesh.positions.push(...point);
        mesh.normals.push(...normal.map((value) => value / length));
        mesh.uvs.push(u, v);
      }
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const a = first + y * (columns + 1) + x,
          b = a + columns + 1;
        mesh.indices.push(a, a + 1, b + 1, a, b + 1, b);
      }
  }
  function box(material: number, center: Vec3, size: Vec3) {
    for (let axis = 0; axis < 3; axis++)
      for (const side of [-1, 1]) {
        const across = (axis + 1) % 3,
          up = (axis + 2) % 3;
        patch(material, 1, 1, (u, v): Vec3 => {
          const point: [number, number, number] = [...center];
          point[axis] += (side * size[axis]) / 2;
          point[across] += side * (u - 0.5) * size[across];
          point[up] += (v - 0.5) * size[up];
          return point;
        });
      }
  }
  function lathe(
    material: number,
    center: Vec3,
    profile: ReadonlyArray<readonly [number, number]>,
    segments = 48,
  ) {
    patch(material, segments, profile.length - 1, (u, v) => {
      const position = v * (profile.length - 1),
        index = Math.min(profile.length - 2, Math.floor(position)),
        mix = position - index,
        [y0, r0] = profile[index],
        [y1, r1] = profile[index + 1],
        radius = r0 + (r1 - r0) * mix,
        angle = u * Math.PI * 2;
      return [
        center[0] + Math.cos(angle) * radius,
        center[1] + y0 + (y1 - y0) * mix,
        center[2] + Math.sin(angle) * radius,
      ];
    });
  }
  function ribbon(
    material: number,
    center: Vec3,
    width: number,
    height: number,
    depth: number,
    folds: number,
    phase = 0,
  ) {
    patch(material, 96, 40, (u, v) => [
      center[0] + (u - 0.5) * width,
      center[1] + (v - 0.5) * height,
      center[2] + Math.sin((u * folds + phase) * Math.PI * 2) * depth * (0.4 + 0.6 * v),
    ]);
  }
  function disc(material: number, center: Vec3, radius: number, sides = 48) {
    patch(material, sides, 1, (u, v) => {
      const angle = u * Math.PI * 2,
        r = radius * v;
      return [center[0] + Math.cos(angle) * r, center[1] + Math.sin(angle) * r, center[2]];
    });
  }
  function oval(material: number, center: Vec3, radiusX: number, radiusY: number, sides = 40) {
    patch(material, sides, 1, (u, v) => {
      const angle = u * Math.PI * 2;
      return [
        center[0] + Math.cos(angle) * radiusX * v,
        center[1] + Math.sin(angle) * radiusY * v,
        center[2],
      ];
    });
  }
  function triangle(material: number, a: Vec3, b: Vec3, c: Vec3) {
    const mesh = surface(material),
      first = mesh.positions.length / 3;
    mesh.positions.push(...a, ...b, ...c);
    mesh.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    mesh.uvs.push(0, 0, 1, 0, 0, 1);
    mesh.indices.push(first, first + 1, first + 2);
  }
  return { surfaces, patch, box, lathe, ribbon, disc, oval, triangle };
}
