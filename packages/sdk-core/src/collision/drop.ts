import { insideTriangle, triangleNormal } from './closest.ts';
import type { CapsuleContact } from './capsule.ts';

/**
 * A SPHERE LOWERED ONTO A TRIANGLE: how far a sphere moving straight down travels before it
 * first touches the triangle — the ground probe of a walker. Unlike a push out of an overlap,
 * a sweep cannot miss a surface it grazes: an edge the sphere only brushes is found at the
 * height where it is brushed.
 *
 * The first touch is the earliest of three: the face, met where the plane lies one radius
 * below the centre, if that point is inside the triangle; an edge, met where the vertical
 * line of the centre comes within a radius of the edge's line, if that point is on the edge;
 * a corner, met where the sphere's surface reaches it. Each is solved in closed form. A
 * negative distance says the sphere already overlaps the triangle and must rise that much.
 */

const face = new Float64Array(3),
  touch = new Float64Array(3);

/**
 * Lowers a sphere of `radius` centred on `centre` onto the triangle `v[at..at+9]`; returns
 * the distance to its first touch, `Infinity` for none. The touch is written into `contact`:
 * `point`, `normal` from the point to the centre, `surface` the face normal turned up.
 */
export function dropSphere(
  centre: ArrayLike<number>,
  radius: number,
  v: ArrayLike<number>,
  at: number,
  contact: CapsuleContact,
) {
  let best = Infinity;
  const keep = (distance: number, x: number, y: number, z: number) => {
    if (!(distance < best)) return;
    best = distance;
    [touch[0], touch[1], touch[2]] = [x, y, z];
  };
  const area = Math.sqrt(triangleNormal(face, v, at));
  if (area === 0) return Infinity;
  const up = face[1] < 0 ? -1 : 1;
  for (let k = 0; k < 3; k++) face[k] *= up / area;
  if (face[1] > 0) {
    const height =
      (centre[0] - v[at]) * face[0] +
      (centre[1] - v[at + 1]) * face[1] +
      (centre[2] - v[at + 2]) * face[2];
    const distance = (height - radius) / face[1];
    const x = centre[0] - radius * face[0],
      y = centre[1] - distance - radius * face[1],
      z = centre[2] - radius * face[2];
    if (insideTriangle(x, y, z, v, at, face)) keep(distance, x, y, z);
  }
  for (let e = 0; e < 3; e++)
    dropOnEdge(centre, radius, v, at + 3 * e, at + 3 * ((e + 1) % 3), keep);
  for (let c = 0; c < 9; c += 3) {
    const dx = centre[0] - v[at + c],
      dz = centre[2] - v[at + c + 2],
      across = radius * radius - dx * dx - dz * dz;
    if (across >= 0)
      keep(centre[1] - v[at + c + 1] - Math.sqrt(across), v[at + c], v[at + c + 1], v[at + c + 2]);
  }
  if (best === Infinity) return best;
  contact.point.set(touch);
  contact.surface.set(face);
  for (let k = 0; k < 3; k++)
    contact.normal[k] = (centre[k] - (k === 1 ? best : 0) - touch[k]) / radius;
  return best;
}

/**
 * The vertical line of the centre against the edge `(p, q)`: the centre, lowered by `t`, lies
 * `radius` from the edge's line when `a t² - 2 b t + c = 0`, `a`, `b` and `c` being read from
 * the parts of the offset and of the vertical that are square to the edge. The first root is
 * the first touch; it counts if its point falls between the edge's ends.
 */
function dropOnEdge(
  centre: ArrayLike<number>,
  radius: number,
  v: ArrayLike<number>,
  p: number,
  q: number,
  keep: (distance: number, x: number, y: number, z: number) => void,
) {
  const ex = v[q] - v[p],
    ey = v[q + 1] - v[p + 1],
    ez = v[q + 2] - v[p + 2];
  const length = ex * ex + ey * ey + ez * ez;
  if (length === 0) return;
  const wx = centre[0] - v[p],
    wy = centre[1] - v[p + 1],
    wz = centre[2] - v[p + 2];
  const along = (wx * ex + wy * ey + wz * ez) / length,
    rise = ey / length;
  // Offset and downward direction, each without its part along the edge.
  const ox = wx - along * ex,
    oy = wy - along * ey,
    oz = wz - along * ez;
  const dx = rise * ex,
    dy = rise * ey - 1,
    dz = rise * ez;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-12) return; // A vertical edge: the sphere slides along it, never onto it.
  const b = -(ox * dx + oy * dy + oz * dz),
    c = ox * ox + oy * oy + oz * oz - radius * radius,
    discriminant = b * b - a * c;
  if (discriminant < 0) return;
  const t = (b - Math.sqrt(discriminant)) / a;
  const s = along - t * rise;
  if (s < 0 || s > 1) return;
  keep(t, v[p] + s * ex, v[p + 1] + s * ey, v[p + 2] + s * ez);
}
