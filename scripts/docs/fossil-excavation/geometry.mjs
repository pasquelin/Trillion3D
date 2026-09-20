const mesh = () => ({ vertices: [], faces: [] });
const vertex = (out, point) => (out.vertices.push(point), out.vertices.length);
const face = (out, a, b, c) => out.faces.push([a, b, c]);

export function box(center, size) {
  const out = mesh(),
    [cx, cy, cz] = center,
    [sx, sy, sz] = size.map((value) => value / 2),
    vertices = [
      [-sx, -sy, -sz],
      [sx, -sy, -sz],
      [sx, sy, -sz],
      [-sx, sy, -sz],
      [-sx, -sy, sz],
      [sx, -sy, sz],
      [sx, sy, sz],
      [-sx, sy, sz],
    ].map(([x, y, z]) => vertex(out, [cx + x, cy + y, cz + z]));
  for (const [a, b, c, d] of [
    [0, 1, 2, 3],
    [5, 4, 7, 6],
    [4, 0, 3, 7],
    [1, 5, 6, 2],
    [3, 2, 6, 7],
    [4, 5, 1, 0],
  ]) {
    face(out, vertices[a], vertices[b], vertices[c]);
    face(out, vertices[a], vertices[c], vertices[d]);
  }
  return out;
}

export function ellipsoid(center, radii, segments = 14, rings = 9) {
  const out = mesh(),
    rows = [];
  for (let ring = 0; ring <= rings; ring++) {
    const v = ring / rings,
      phi = v * Math.PI,
      row = [];
    for (let segment = 0; segment < segments; segment++) {
      const theta = (segment / segments) * Math.PI * 2;
      row.push(
        vertex(out, [
          center[0] + radii[0] * Math.sin(phi) * Math.cos(theta),
          center[1] + radii[1] * Math.cos(phi),
          center[2] + radii[2] * Math.sin(phi) * Math.sin(theta),
        ]),
      );
    }
    rows.push(row);
  }
  for (let ring = 0; ring < rings; ring++)
    for (let segment = 0; segment < segments; segment++) {
      const next = (segment + 1) % segments;
      face(out, rows[ring][segment], rows[ring + 1][segment], rows[ring + 1][next]);
      face(out, rows[ring][segment], rows[ring + 1][next], rows[ring][next]);
    }
  return out;
}

const normalize = (v) => {
  const length = Math.hypot(...v) || 1;
  return v.map((value) => value / length);
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function bone(start, end, radius, sides = 12) {
  const out = mesh(),
    axis = normalize(end.map((value, index) => value - start[index])),
    guide = Math.abs(axis[1]) < 0.85 ? [0, 1, 0] : [1, 0, 0],
    u = normalize(cross(axis, guide)),
    v = cross(axis, u),
    rings = [];
  for (const point of [start, end]) {
    const ring = [];
    for (let side = 0; side < sides; side++) {
      const angle = (side / sides) * Math.PI * 2;
      ring.push(
        vertex(
          out,
          point.map(
            (value, index) =>
              value + radius * (u[index] * Math.cos(angle) + v[index] * Math.sin(angle)),
          ),
        ),
      );
    }
    rings.push(ring);
  }
  const caps = [vertex(out, start), vertex(out, end)];
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides;
    face(out, rings[0][side], rings[1][side], rings[1][next]);
    face(out, rings[0][side], rings[1][next], rings[0][next]);
    face(out, caps[0], rings[0][next], rings[0][side]);
    face(out, caps[1], rings[1][side], rings[1][next]);
  }
  return out;
}

export function merge(parts) {
  const out = mesh();
  for (const part of parts) {
    const offset = out.vertices.length;
    out.vertices.push(...part.vertices);
    out.faces.push(...part.faces.map((indices) => indices.map((index) => index + offset)));
  }
  return out;
}
