/**
 * Oracle of the blend slice of a tile that sees the sky, a line-by-line port of `tileCorner`,
 * `inwardPlane`, `tileColumn` and `sphereTouchesColumn` in
 * packages/sdk-browser/src/lighting/tiles/shader.ts. `inverseViewProjection` is column-major,
 * like the uniform; depth is reversed with an infinite far plane.
 */
type Vec3 = [number, number, number];
export type TileView = { inverseViewProjection: ArrayLike<number>; width: number; height: number };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function unproject(m: ArrayLike<number>, x: number, y: number, z: number): Vec3 {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [0, 1, 2].map((r) => (m[r] * x + m[r + 4] * y + m[r + 8] * z + m[r + 12]) / w) as Vec3;
}

export function tileCorner(view: TileView, tile: [number, number], corner: number, z: number) {
  const size = 16;
  const x =
    corner & 1 ? Math.min(((tile[0] + 1) * size) / view.width, 1) : (tile[0] * size) / view.width;
  const y =
    corner & 2 ? Math.min(((tile[1] + 1) * size) / view.height, 1) : (tile[1] * size) / view.height;
  return unproject(view.inverseViewProjection, x * 2 - 1, 1 - y * 2, z);
}

function inwardPlane(normal: Vec3, point: Vec3, inside: Vec3) {
  const length = Math.hypot(...normal);
  let n = normal.map((v) => v / length) as Vec3;
  if (dot(n, sub(inside, point)) < 0) n = n.map((v) => -v) as Vec3;
  return { n, w: -dot(n, point) };
}

export function tileColumn(view: TileView, tile: [number, number]) {
  const order = [0, 1, 3, 2];
  const near = order.map((c) => tileCorner(view, tile, c, 1));
  const deep = order.map((c) => tileCorner(view, tile, c, 1 / 1024));
  const inside = [0, 1, 2].map((a) => deep.reduce((s, p) => s + p[a] * 0.25, 0)) as Vec3;
  const planes = order.map((_, i) =>
    inwardPlane(cross(sub(deep[(i + 1) % 4], deep[i]), sub(deep[i], near[i])), near[i], inside),
  );
  planes.push(inwardPlane(cross(sub(deep[1], deep[0]), sub(deep[3], deep[0])), near[0], inside));
  return planes;
}

export function sphereTouchesColumn(
  column: ReturnType<typeof tileColumn>,
  centre: Vec3,
  radius: number,
) {
  return column.every((plane) => dot(plane.n, centre) + plane.w >= -radius);
}
