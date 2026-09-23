// Geometry model for `erreur-ecran-borne.ts`: a drawn view (rotation, non-uniform or uniform
// scale), the old screen-error formula, and the worst true screen displacement search per family.
// Kept apart from orchestration and reporting so the campaign file stays under the line budget.
import { maxStretch } from '../../../packages/sdk-core/index.ts';
import { lois, mulberry32 } from './tirage.ts';
import type { Vec3, Mat3 } from './vecTypes.ts';

export interface Cas {
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

const { hasard, entre, log } = lois(mulberry32(0x9e3779b9));
const unitaire = (): Vec3 => {
  const z = entre(-1, 1),
    a = entre(0, 2 * Math.PI),
    r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), r * Math.sin(a), z];
};
const norme = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const applique = (m: Mat3, v: Vec3): Vec3 =>
  [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);

/** The old formula, as the engine applied it before the fix. */
export function ancienne(
  error: number,
  stretch: number,
  c: Vec3,
  radius: number,
  focal: number,
  near: number,
): number {
  const distance = norme(c) - radius * stretch;
  return distance > near ? (error * stretch * focal) / distance : Infinity;
}

/** A drawn view: linear L = R·S, its inverse, stretch, focals and imposed view centre. */
export function tirerCas(famille: string): Cas {
  const q = unitaire(),
    angle = entre(0, Math.PI),
    [x, y, z] = q,
    c = Math.cos(angle),
    s1 = Math.sin(angle),
    u = 1 - c;
  const R = [
    [c + x * x * u, x * y * u - z * s1, x * z * u + y * s1],
    [y * x * u + z * s1, c + y * y * u, y * z * u - x * s1],
    [z * x * u - y * s1, z * y * u + x * s1, c + z * z * u],
  ];
  const uniforme = hasard() < 0.35;
  const S = uniforme ? Array(3).fill(log(0.2, 5)) : [log(0.2, 5), log(0.2, 5), log(0.2, 5)];
  const L = R.map((ligne) => ligne.map((v, j) => v * S[j]));
  const Linv = [0, 1, 2].map((i) => [0, 1, 2].map((j) => R[j][i] / S[i]));
  const elements = [L[0][0], L[1][0], L[2][0], 0, L[0][1], L[1][1], L[2][1], 0];
  elements.push(L[0][2], L[1][2], L[2][2], 0, 0, 0, 0, 1);
  const stretch = maxStretch(elements);
  const fov = entre(20, 120) * (Math.PI / 180),
    aspect = log(0.5, 2.5),
    near = log(0.01, 1);
  const p11 = 1 / Math.tan(fov / 2),
    p00 = p11 / aspect,
    hauteur = Math.round(entre(300, 2200));
  const fx = (Math.round(hauteur * aspect) * p00) / 2,
    fy = (hauteur * p11) / 2;
  const radius = log(1e-3, 3),
    rho = radius * stretch;
  const error = radius * log(1e-4, 0.5);
  const delta = error * stretch;
  const nearest = famille === 'planProche' ? near + delta + near * log(1e-6, 0.5) : 0;
  const depth = famille === 'planProche' ? nearest + rho : near + delta + rho + log(1e-3, 1e3);
  const centre = [(entre(-1, 1) * depth) / p00, (entre(-1, 1) * depth) / p11, -depth];
  return { L, Linv, stretch, fx, fy, near, radius, error, centre };
}

/** True screen displacement of view point `p` displaced by `d` (view), in pixels. */
function reel(k: Cas, p: Vec3, d: Vec3): number {
  const z0 = -p[2],
    z1 = -(p[2] + d[2]);
  if (!(z1 > 0) || !(z0 > 0)) return Infinity;
  const du = k.fx * ((p[0] + d[0]) / z1 - p[0] / z0),
    dv = k.fy * ((p[1] + d[1]) / z1 - p[1] / z0);
  return Math.hypot(du, dv);
}

/** Family view direction, brought to an object displacement of length ε then into view. */
function deplacement(k: Cas, famille: string, p: Vec3, graineDir: number[]): Vec3 {
  let d: Vec3;
  if (famille === 'perpendiculaire') {
    const a = graineDir[0] * Math.PI;
    d = [Math.cos(a), Math.sin(a), 0];
  } else if (famille === 'profondeur') d = [0, 0, graineDir[0] < 0 ? -1 : 1];
  else if (graineDir[1] > 0.5) {
    const qx = p[0] / -p[2],
      qy = p[1] / -p[2],
      q2 = qx * qx + qy * qy;
    d = [qx, qy, q2 * Math.sign(graineDir[0] || 1)];
  } else d = graineDir.slice(2, 5);
  const objet = applique(k.Linv, d),
    n = norme(objet);
  return applique(
    k.L,
    objet.map((v) => (v / n) * k.error),
  );
}

/** Worst-case true screen displacement over the family, found by coarse sampling then hill climb. */
export function pireDuCas(k: Cas, famille: string): number {
  const vue = (u: Vec3, t: number): Vec3 => {
    const r = k.radius * t;
    return applique(k.L, [u[0] * r, u[1] * r, u[2] * r]).map((v, i) => v + k.centre[i]);
  };
  const essai = (u: Vec3, t: number, g: number[]): number => {
    const p = vue(u, t);
    return reel(k, p, deplacement(k, famille, p, g));
  };
  let meilleur = { v: -1, u: unitaire(), t: 0, g: [0, 0, 0, 0, 0] as number[] };
  for (let i = 0; i < 24; i++) {
    const u = unitaire(),
      t = i < 16 ? 1 : hasard();
    const g = [entre(-1, 1), hasard(), ...unitaire()];
    const v = essai(u, t, g);
    if (v > meilleur.v) meilleur = { v, u, t, g };
  }
  for (let pas = 0.5; pas > 1e-3; pas *= 0.7) {
    const u = meilleur.u.map((x) => x + pas * entre(-1, 1)),
      n = norme(u);
    const g = meilleur.g.map((x, i) => (i === 1 ? x : x + pas * entre(-1, 1)));
    const v = essai(
      u.map((x) => x / n),
      Math.min(1, meilleur.t + pas * entre(-0.2, 0.2)),
      g,
    );
    if (v > meilleur.v) meilleur = { v, u: u.map((x) => x / n), t: meilleur.t, g };
  }
  return meilleur.v;
}
