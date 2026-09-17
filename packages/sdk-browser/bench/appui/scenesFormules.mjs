// Les entrées du banc d'équivalence des formules communes : tirées à graine fixe, et volontairement
// hostiles. Une factorisation qui ne tiendrait que sur des nombres bien élevés se verrait ici — NaN,
// −0, infinis, dénormaux, matrices singulières, boîtes inversées, triangles d'aire nulle.
import { graine } from '../../../sdk-core/bench/socle.mjs';

const alea = graine(40961);
/** Les valeurs qu'un flottant peut prendre et qu'une formule doit traverser sans les lisser. */
const BORDS = [0, -0, 1, -1, Infinity, -Infinity, NaN, 5e-324, Number.MIN_VALUE, 1e308, -1e308];
const nombre = () => {
  if (alea() < 0.12) return BORDS[Math.floor(alea() * BORDS.length)];
  return (alea() * 2 - 1) * 10 ** Math.floor(alea() * 12 - 6);
};

/** Six plans par jeu, quelques-uns dégénérés, et la boîte que chacun teste. */
export const casPlans = [];
for (let i = 0; i < 400; i++) {
  const planes = new Float64Array(24);
  for (let k = 0; k < 24; k++) planes[k] = i % 17 === 0 ? nombre() : alea() * 4 - 2;
  const c = [alea() * 20 - 10, alea() * 20 - 10, alea() * 20 - 10];
  const e = i % 11 === 0 ? 0 : alea() * 5;
  const boite = [c[0] - e, c[1] - e, c[2] - e, c[0] + e, c[1] + e, c[2] + e];
  if (i % 23 === 0) boite[0] = NaN;
  if (i % 29 === 0) boite[3] = -Infinity;
  casPlans.push({ planes, boite });
}

/** Des triangles écran : ordinaires, hors champ, dégénérés, et certains à sommet non fini. */
const point = (i) => ({
  x: i % 19 === 0 ? nombre() : alea() * 2000 - 500,
  y: i % 23 === 0 ? nombre() : alea() * 2000 - 500,
  z: alea(),
  invW: alea(),
});
export const triangles = [];
for (let i = 0; i < 3000; i++) {
  const a = point(i),
    b = point(i + 1),
    c = i % 37 === 0 ? { ...a } : point(i + 2);
  triangles.push({ a, b, c, x: alea() * 1000 - 100, y: alea() * 1000 - 100 });
}

/** Les rangs de ligne du tableau de pages, jusqu'au-delà du million. */
export const rangs = [];
for (let i = 0; i < 2000; i++) rangs.push(i % 17 === 0 ? Math.floor(alea() * 1e7) : i);

/** Les plafonds de travail et les charges que le budget du rebond leur applique. */
export const lots = [];
for (let i = 0; i < 2000; i++)
  lots.push({ ceiling: i % 11 === 0 ? nombre() : Math.floor(alea() * 1e6), load: alea() });

/** Les dimensions logiques et les rapports de pixels que l'hôte règle, `undefined` compris. */
export const tailles = [];
for (let i = 0; i < 2000; i++)
  tailles.push({
    logical: i % 13 === 0 ? nombre() : Math.floor(alea() * 4000),
    ratio: i % 5 === 0 ? undefined : alea() * 4,
  });

/** Les durées en nanosecondes que les deux chronomètres de carte graphique rendent. */
export const durees = [];
for (let i = 0; i < 2000; i++) durees.push(i % 7 === 0 ? nombre() : alea() * 1e12);

/** Les emprises dont le banc tire le plancher du modèle, y compris celles qui enjambent zéro. */
export const emprises = [];
for (let i = 0; i < 1000; i++) {
  const y0 = alea() * 20 - 10,
    y1 = y0 + alea() * 20;
  emprises.push({
    min: { x: 0, y: i % 11 === 0 ? nombre() : y0, z: 0 },
    max: { x: 1, y: i % 13 === 0 ? nombre() : y1, z: 1 },
  });
}
