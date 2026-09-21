/** A 3-component position, direction or normal: either a plain triple or an engine-owned typed array. */
export type Vec3Like = number[] | Float64Array;
/** An RGB colour, always a literal triple. */
export type Color = [number, number, number];

export const vertices: number[] = [];
export const COLORS: Record<string, Color> = {
  blue: [0.12, 0.42, 0.9],
  orange: [0.95, 0.34, 0.08],
  red: [0.85, 0.12, 0.18],
  violet: [0.48, 0.22, 0.85],
  cyan: [0.04, 0.62, 0.72],
  grey: [0.68, 0.75, 0.84],
  green: [0.1, 0.65, 0.36],
};
const FACES: number[][] = [
  [0, 1, 2, 0, 2, 3, 0, 0, -1],
  [5, 4, 7, 5, 7, 6, 0, 0, 1],
  [4, 0, 3, 4, 3, 7, -1, 0, 0],
  [1, 5, 6, 1, 6, 2, 1, 0, 0],
  [3, 2, 6, 3, 6, 7, 0, 1, 0],
  [4, 5, 1, 4, 1, 0, 0, -1, 0],
];

function pushTriangle(points: Vec3Like[], normal: Vec3Like, color: Color) {
  points.forEach((point) => vertices.push(...point, ...normal, ...color));
}

export function box(center: Vec3Like, size: Vec3Like, color: Color = COLORS.violet) {
  const [x, y, z] = center,
    [sx, sy, sz] = size;
  const corners = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ].map(([a, b, c]) => [x + (a * sx) / 2, y + (b * sy) / 2, z + (c * sz) / 2]);
  FACES.forEach(([a, b, c, d, e, f, nx, ny, nz]) => {
    pushTriangle([corners[a], corners[b], corners[c]], [nx, ny, nz], color);
    pushTriangle([corners[d], corners[e], corners[f]], [nx, ny, nz], color);
  });
}

export function beam(from: Vec3Like, to: Vec3Like, width: number, color: Color) {
  const dx = to[0] - from[0],
    dy = to[1] - from[1],
    dz = to[2] - from[2],
    length = Math.hypot(dx, dy, dz) || 1;
  const forward = [dx / length, dy / length, dz / length],
    up = Math.abs(forward[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const side = [
    forward[1] * up[2] - forward[2] * up[1],
    forward[2] * up[0] - forward[0] * up[2],
    forward[0] * up[1] - forward[1] * up[0],
  ];
  const sl = Math.hypot(...side),
    s = side.map((v) => v / sl),
    u = [
      s[1] * forward[2] - s[2] * forward[1],
      s[2] * forward[0] - s[0] * forward[2],
      s[0] * forward[1] - s[1] * forward[0],
    ];
  const center = from.map((v, i) => (v + to[i]) / 2),
    corners: Vec3Like[] = [];
  for (const a of [-1, 1])
    for (const b of [-1, 1])
      for (const c of [-1, 1])
        corners.push(
          center.map(
            (v, i) => v + s[i] * a * width + u[i] * b * width + (forward[i] * c * length) / 2,
          ),
        );
  const order = [0, 4, 6, 2, 1, 3, 7, 5];
  const mapped = order.map((i) => corners[i]);
  FACES.forEach(([a, b, c, d, e, f, nx, ny, nz]) => {
    pushTriangle([mapped[a], mapped[b], mapped[c]], [nx, ny, nz], color);
    pushTriangle([mapped[d], mapped[e], mapped[f]], [nx, ny, nz], color);
  });
}

export const arrow = (vector: Vec3Like, color: Color, scale = 2.2) => {
  const end = [vector[0] * scale, vector[1] * scale, (vector[2] ?? 0) * scale];
  beam([0, 0, 0], end, 0.055, color);
  box(end, [0.22, 0.22, 0.22], color);
};

export const frameBox = (min: Vec3Like, max: Vec3Like, color: Color) => {
  const corners: Vec3Like[] = [];
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) corners.push([x, y, z]);
  [
    [0, 1],
    [0, 2],
    [0, 4],
    [1, 3],
    [1, 5],
    [2, 3],
    [2, 6],
    [3, 7],
    [4, 5],
    [4, 6],
    [5, 7],
    [6, 7],
  ].forEach(([a, b]) => beam(corners[a], corners[b], 0.025, color));
};

export function sphere(center: Vec3Like, r: number, color: Color) {
  const point = (axis: number, angle: number): Vec3Like => {
    const a = Math.cos(angle) * r,
      b = Math.sin(angle) * r;
    return axis === 0
      ? [center[0], center[1] + a, center[2] + b]
      : axis === 1
        ? [center[0] + a, center[1], center[2] + b]
        : [center[0] + a, center[1] + b, center[2]];
  };
  for (let axis = 0; axis < 3; axis++)
    for (let step = 0; step < 24; step++)
      beam(
        point(axis, (step * Math.PI) / 12),
        point(axis, ((step + 1) * Math.PI) / 12),
        0.018,
        color,
      );
}

/** The drawing primitives `advancedGeometry` receives, so it never imports the dispatch module at runtime. */
export interface GeometryTools {
  arrow: typeof arrow;
  beam: typeof beam;
  box: typeof box;
  COLORS: typeof COLORS;
}
