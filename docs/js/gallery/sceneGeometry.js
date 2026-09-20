const vertices = [];
const COLORS = {
  blue: [0.12, 0.42, 0.9],
  orange: [0.95, 0.34, 0.08],
  red: [0.85, 0.12, 0.18],
  violet: [0.48, 0.22, 0.85],
  cyan: [0.04, 0.62, 0.72],
  grey: [0.68, 0.75, 0.84],
  green: [0.1, 0.65, 0.36],
};
const FACES = [
  [0, 1, 2, 0, 2, 3, 0, 0, -1],
  [5, 4, 7, 5, 7, 6, 0, 0, 1],
  [4, 0, 3, 4, 3, 7, -1, 0, 0],
  [1, 5, 6, 1, 6, 2, 1, 0, 0],
  [3, 2, 6, 3, 6, 7, 0, 1, 0],
  [4, 5, 1, 4, 1, 0, 0, -1, 0],
];

function pushTriangle(points, normal, color) {
  points.forEach((point) => vertices.push(...point, ...normal, ...color));
}

function box(center, size, color = COLORS.violet) {
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

function beam(from, to, width, color) {
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
    corners = [];
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

const arrow = (vector, color, scale = 2.2) => {
  const end = [vector[0] * scale, vector[1] * scale, (vector[2] ?? 0) * scale];
  beam([0, 0, 0], end, 0.055, color);
  box(end, [0.22, 0.22, 0.22], color);
};
const frameBox = (min, max, color) => {
  const corners = [];
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

function sphere(center, r, color) {
  const point = (axis, angle) => {
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

export function geometryFor(id, result) {
  vertices.length = 0;
  if (id === 'compose-transform') {
    box([0, 0, 0], [2, 1.4, 0.18], COLORS.grey);
    const p = result.points;
    p.forEach((point, index) =>
      beam(
        [point[0], point[1], 0.35],
        [p[(index + 1) % p.length][0], p[(index + 1) % p.length][1], 0.35],
        0.07,
        COLORS.violet,
      ),
    );
  } else if (id === 'matrix-chain' || id === 'hierarchy') {
    beam([0, 0, 0], result.point, 0.07, COLORS.violet);
    box([0, 0, 0], [0.35, 0.35, 0.35], COLORS.blue);
    box(result.point, [0.45, 0.45, 0.45], COLORS.orange);
  } else if (id === 'perspective') {
    const half = Math.tan((result.fov * Math.PI) / 360) * 2,
      offset = result.depth / 2;
    const projected = [result.ndc[0] * half * 1.6, result.ndc[1] * half, offset - 2];
    frameBox([-half * 1.6, -half, offset - 2.02], [half * 1.6, half, offset - 1.98], COLORS.grey);
    beam([0, 0, offset], [1, 1, -offset], 0.025, COLORS.cyan);
    box(projected, [0.22, 0.22, 0.12], COLORS.orange);
  } else if (id === 'frustum') {
    const depth = result.depth,
      h = Math.tan((result.fov * Math.PI) / 360) * depth,
      w = h * 1.6;
    [
      [-w, -h],
      [w, -h],
      [-w, h],
      [w, h],
    ].forEach(([x, y]) => beam([0, 0, depth / 2], [x, y, -depth / 2], 0.025, COLORS.cyan));
    box(
      [result.x, 0, -depth / 2],
      [1.2, 1.2, 1.2],
      [COLORS.red, COLORS.orange, COLORS.green][result.status],
    );
  } else if (id === 'dot-product' || id === 'cross-product') {
    arrow(result.a, COLORS.blue);
    arrow(result.b, COLORS.orange);
    if ('cross' in result) arrow([0, 0, result.cross], COLORS.green);
  } else if (id === 'normalize') {
    arrow(result.before, COLORS.grey, 0.65);
    arrow(result.after, COLORS.violet, 0.65);
  } else if (id === 'box-grow') {
    result.points.forEach(([x, y]) => box([x, y, 0], [0.18, 0.18, 0.18], COLORS.orange));
    frameBox(result.box.slice(0, 3), result.box.slice(3), COLORS.violet);
  } else if (id === 'sphere-from-box') {
    frameBox(result.box.slice(0, 3), result.box.slice(3), COLORS.violet);
    sphere(result.sphere.slice(0, 3), result.sphere[3], COLORS.cyan);
  } else if (id === 'color-space') {
    [result.a, result.screen, result.light, result.b].forEach((v, i) =>
      box([(i - 1.5) * 1.1, 0, 0], [0.85, 0.85, 0.85], [v, v, v]),
    );
  } else {
    for (let i = 0; i < 10; i++) box([(i - 4.5) * 0.48, 0, 0], [0.3, 0.3, 0.3], COLORS.grey);
    const marker = Math.max(-2.16, Math.min(2.16, (result.error / 8) * 4.32 - 2.16));
    beam([marker, -0.7, 0], [marker, 0.7, 0], 0.05, COLORS.orange);
  }
  return new Float32Array(vertices);
}
