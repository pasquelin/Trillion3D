// The true screen displacement a cluster's error can cause, searched by brute force, against which
// `screenErrorDisplacement.test.ts` holds the certified bound (`screenErrorBound.ts`). A drawn view
// — a rotation and a uniform or non-uniform scale —, an object sphere whose view centre reaches the
// field's edges, an error ε, and the worst pair (sphere point, displacement of at most ε) found by
// sampling then climbing, per family of displacement.
import { maxStretch } from '../math/projectionOracles.ts';

type Vec3 = number[];
type Mat3 = number[][];

/** How the displacement is drawn: across the view axis, along it (toward the camera or away),
 *  oblique (any, or the worst analytic direction), or any with the sphere grazing the near plane. */
export const FAMILIES = ['perpendicular', 'depth', 'oblique', 'nearPlane'] as const;
export type Family = (typeof FAMILIES)[number];

export interface DisplacementCase {
  L: Mat3;
  Linv: Mat3;
  stretch: number;
  fx: number;
  fy: number;
  near: number;
  radius: number;
  error: number;
  centre: Vec3;
}

/** A seeded draw: a 32-bit linear congruential sequence, uniform, and uniform on a log scale. */
export function draws(seed: number) {
  let state = seed >>> 0;
  const chance = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 2 ** 32;
  return {
    chance,
    between: (a: number, b: number) => a + (b - a) * chance(),
    log: (a: number, b: number) => a * (b / a) ** chance(),
  };
}
type Draws = ReturnType<typeof draws>;

const unit = ({ between }: Draws): Vec3 => {
  const z = between(-1, 1),
    a = between(0, 2 * Math.PI),
    r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), r * Math.sin(a), z];
};
const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const apply = (m: Mat3, v: Vec3): Vec3 =>
  [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);

/** A drawn view: its linear part L = R·S and inverse, its stretch, focal lengths, near plane, and
 *  a sphere and error placed for `family`. */
export function drawCase(d: Draws, family: Family): DisplacementCase {
  const [x, y, z] = unit(d),
    angle = d.between(0, Math.PI),
    c = Math.cos(angle),
    s = Math.sin(angle),
    u = 1 - c;
  const R = [
    [c + x * x * u, x * y * u - z * s, x * z * u + y * s],
    [y * x * u + z * s, c + y * y * u, y * z * u - x * s],
    [z * x * u - y * s, z * y * u + x * s, c + z * z * u],
  ];
  const S = d.chance() < 0.35 ? Array(3).fill(d.log(0.2, 5)) : [0, 1, 2].map(() => d.log(0.2, 5));
  const L = R.map((row) => row.map((v, j) => v * S[j]));
  const Linv = [0, 1, 2].map((i) => [0, 1, 2].map((j) => R[j][i] / S[i]));
  const stretch = maxStretch([
    ...[0, 1, 2].flatMap((j) => [L[0][j], L[1][j], L[2][j], 0]),
    0,
    0,
    0,
    1,
  ]);
  const fov = d.between(20, 120) * (Math.PI / 180),
    aspect = d.log(0.5, 2.5),
    near = d.log(0.01, 1);
  const p11 = 1 / Math.tan(fov / 2),
    p00 = p11 / aspect,
    height = Math.round(d.between(300, 2200));
  const fx = (Math.round(height * aspect) * p00) / 2,
    fy = (height * p11) / 2;
  const radius = d.log(1e-3, 3),
    reach = radius * stretch;
  const error = radius * d.log(1e-4, 0.5);
  const shift = error * stretch;
  const grazing = family === 'nearPlane';
  const nearest = grazing ? near + shift + near * d.log(1e-6, 0.5) : 0;
  const depth = grazing ? nearest + reach : near + shift + reach + d.log(1e-3, 1e3);
  const centre = [(d.between(-1, 1) * depth) / p00, (d.between(-1, 1) * depth) / p11, -depth];
  return { L, Linv, stretch, fx, fy, near, radius, error, centre };
}

/** The true screen displacement, in pixels, of view point `p` moved by `delta` (view). */
function displacement(k: DisplacementCase, p: Vec3, delta: Vec3) {
  const z0 = -p[2],
    z1 = -(p[2] + delta[2]);
  if (!(z1 > 0) || !(z0 > 0)) return Infinity;
  const du = k.fx * ((p[0] + delta[0]) / z1 - p[0] / z0),
    dv = k.fy * ((p[1] + delta[1]) / z1 - p[1] / z0);
  return Math.hypot(du, dv);
}

/** The family's view direction for point `p`, made an object displacement of length ε, back in
 *  view. `g` seeds the direction. */
function moveOf(k: DisplacementCase, family: Family, p: Vec3, g: number[]): Vec3 {
  let direction: Vec3;
  if (family === 'perpendicular')
    direction = [Math.cos(g[0] * Math.PI), Math.sin(g[0] * Math.PI), 0];
  else if (family === 'depth') direction = [0, 0, g[0] < 0 ? -1 : 1];
  else if (g[1] > 0.5) {
    const qx = p[0] / -p[2],
      qy = p[1] / -p[2];
    direction = [qx, qy, (qx * qx + qy * qy) * Math.sign(g[0] || 1)];
  } else direction = g.slice(2, 5);
  const inObject = apply(k.Linv, direction),
    n = norm(inObject);
  return apply(
    k.L,
    inObject.map((v) => (v / n) * k.error),
  );
}

/** The worst true displacement over the family: a coarse sampling, then a hill climb. */
export function worstDisplacement(d: Draws, k: DisplacementCase, family: Family) {
  const point = (u: Vec3, t: number) =>
    apply(
      k.L,
      u.map((v) => v * k.radius * t),
    ).map((v, i) => v + k.centre[i]);
  const trial = (u: Vec3, t: number, g: number[]) => {
    const p = point(u, t);
    return displacement(k, p, moveOf(k, family, p, g));
  };
  let best = { value: -1, u: unit(d), t: 0, g: [0, 0, 0, 0, 0] };
  for (let i = 0; i < 24; i++) {
    const u = unit(d),
      t = i < 16 ? 1 : d.chance();
    const g = [d.between(-1, 1), d.chance(), ...unit(d)];
    const value = trial(u, t, g);
    if (value > best.value) best = { value, u, t, g };
  }
  for (let step = 0.5; step > 1e-3; step *= 0.7) {
    const moved = best.u.map((x) => x + step * d.between(-1, 1)),
      n = norm(moved),
      u = moved.map((x) => x / n);
    const g = best.g.map((x, i) => (i === 1 ? x : x + step * d.between(-1, 1)));
    const t = Math.min(1, best.t + step * d.between(-0.2, 0.2));
    const value = trial(u, t, g);
    if (value > best.value) best = { value, u, t, g };
  }
  return best.value;
}
