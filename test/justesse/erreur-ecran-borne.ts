// Correctness of screen error: does the error announced by `clusterErrorPixels` bound the true
// displacement, in pixels, of every sphere point displaced by at most ε, after perspective
// projection?
//
// Each case draws a view (rotation, non-uniform or uniform scale), an object sphere whose view
// centre goes to the field edges, an error ε, then seeks the worst pair (sphere point,
// displacement): extreme and drawn points, view direction per family brought into object at
// length ε, then local lift. Families: displacement perpendicular to the view axis, in depth
// (toward the camera and opposite), oblique (arbitrary, and the worst analytic direction), and
// a sphere whose nearest point grazes the near plane. The worst true/announced ratio is given
// for the old formula (`ε·s·f / (|C| − r·s)`, copied here) and for the engine; monotonicity
// (distance along the ray, growing radius) is checked on the engine.
//
// node --experimental-strip-types test/justesse/erreur-ecran-borne.ts [cas]
import assert from 'node:assert/strict';
import { clusterErrorPixels } from '../../packages/sdk-core/index.ts';
import { ancienne, tirerCas, pireDuCas } from './erreurEcranBorneCas.ts';

interface Serie {
  rapports: number[];
  violations: number;
}
interface Rapport {
  cas: number;
  familles: Record<string, unknown>;
  violationsMoteur?: number;
  monotonieRompue?: number;
}

const CAS = Number(process.argv[2] ?? 20000);
const familles = ['perpendiculaire', 'profondeur', 'oblique', 'planProche'];
const rapport: Rapport = { cas: CAS, familles: {} };
let violationsMoteur = 0,
  monotonie = 0;
/** Worst true/announced ratio, median, first decile (widest bound) and violations. */
const serie = (): Serie => ({ rapports: [], violations: 0 });
const ajoute = (s: Serie, vrai: number, annonce: number): void => {
  if (!Number.isFinite(annonce)) return;
  s.rapports.push(vrai / annonce);
  if (vrai > annonce) s.violations++;
};
const resume = (s: Serie) => {
  const r = s.rapports.sort((a, b) => a - b),
    arrondi = (v: number) => Number((v ?? 0).toFixed(4));
  return {
    pire: arrondi(r[r.length - 1]),
    median: arrondi(r[r.length >> 1]),
    decile: arrondi(r[Math.floor(r.length / 10)]),
    violations: s.violations,
  };
};
for (const famille of familles) {
  const series = {
    ancienne: serie(),
    engine: serie(),
    ancienneSpherePetite: serie(),
    moteurSpherePetite: serie(),
  };
  for (let i = 0; i < CAS; i++) {
    const k = tirerCas(famille);
    const focal = Math.max(k.fx, k.fy),
      [cx, cy, cz] = k.centre;
    const engine = (m: number, r: number) =>
      clusterErrorPixels(k.error, k.stretch, cx * m, cy * m, cz * m, r, focal, k.near);
    const annonce = engine(1, k.radius);
    const before = ancienne(k.error, k.stretch, k.centre, k.radius, focal, k.near);
    const vrai = pireDuCas(k, famille);
    ajoute(series.ancienne, vrai, before);
    ajoute(series.engine, vrai, annonce);
    // Current regime: the stretched sphere fits in 2 % of its depth.
    if (k.radius * k.stretch < -cz * 0.02) {
      ajoute(series.ancienneSpherePetite, vrai, before);
      ajoute(series.moteurSpherePetite, vrai, annonce);
    }
    const loin = engine(2, k.radius),
      grand = engine(1, k.radius * 1.5);
    if (!(loin <= annonce) || !(grand >= annonce)) monotonie++;
  }
  violationsMoteur += series.engine.violations;
  rapport.familles[famille] = Object.fromEntries(
    Object.entries(series).map(([name, s]) => [name, resume(s)]),
  );
}
rapport.violationsMoteur = violationsMoteur;
rapport.monotonieRompue = monotonie;
console.log(JSON.stringify(rapport, null, 2));
assert.equal(monotonie, 0, 'broken monotonicity: distance along the ray or growing radius');
assert.equal(violationsMoteur, 0, 'the engine announces less than the true screen displacement');
