/**
 * Oriented rectangles on the ground (x, z): a centre, half extents along the rectangle's own
 * X and Z, and the yaw that turns them (a prop's frame, `trsMatrix`'s convention).
 */
export type Rect = { x: number; z: number; hw: number; hd: number; yaw: number };

/** The rectangle's own X and Z axes in world (x, z). */
const axes = ({ yaw }: Rect): [[number, number], [number, number]] => [
  [Math.cos(yaw), -Math.sin(yaw)],
  [Math.sin(yaw), Math.cos(yaw)],
];

export function corners(rect: Rect): [number, number][] {
  const [ax, az] = axes(rect);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([i, j]) => [
    rect.x + i * rect.hw * ax[0] + j * rect.hd * az[0],
    rect.z + i * rect.hw * ax[1] + j * rect.hd * az[1],
  ]);
}

/** True when the point lies inside the rectangle. */
export function inside(rect: Rect, x: number, z: number): boolean {
  const [ax, az] = axes(rect),
    dx = x - rect.x,
    dz = z - rect.z;
  return (
    Math.abs(dx * ax[0] + dz * ax[1]) <= rect.hw && Math.abs(dx * az[0] + dz * az[1]) <= rect.hd
  );
}

/** True when the two rectangles share an area (separating-axis test; touching is not overlap). */
export function overlaps(a: Rect, b: Rect): boolean {
  const ca = corners(a),
    cb = corners(b);
  for (const axis of [...axes(a), ...axes(b)]) {
    const project = (points: [number, number][]) =>
      points.map(([x, z]) => x * axis[0] + z * axis[1]);
    const pa = project(ca),
      pb = project(cb);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6)
      return false;
  }
  return true;
}
