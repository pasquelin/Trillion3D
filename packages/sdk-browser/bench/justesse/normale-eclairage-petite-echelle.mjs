// Défaut 9 : dans `NORMAL_TRANSFORM_WGSL` (standardLighting.ts), le garde `abs(det)<1e-20` portait
// sur le déterminant BRUT de la 3×3 monde. Une rotation d'échelle uniforme s a pour déterminant
// ±s³ : dès s ≲ 2,15e-7, `inverseTranspose3` rendait la normale LOCALE, non tournée — la surface
// était éclairée comme si elle n'avait pas tourné. Même défaut que le 6, autre fichier ; corrigé en
// partageant le texte (`inverseTransposeWgsl.ts`) au lieu d'en réécrire une variante.
//
// La campagne exécute le MÊME shader deux fois dans Chromium WebGPU — texte d'avant le lot
// reconstruit, puis texte livré — sur les mêmes cas, et chiffre l'angle entre la normale rendue et
// la normale vraie (Three en f64) ainsi que l'écart relatif de luminance de la même BRDF.
//
// LAB_ROOT=… node --experimental-strip-types \
//   packages/sdk-browser/bench/justesse/normale-eclairage-petite-echelle.mjs
import assert from 'node:assert/strict';
import { NORMAL_TRANSFORM_WGSL } from '../../standardLighting.ts';
import {
  INVERSE_TRANSPOSE_AVANT_WGSL,
  INVERSE_TRANSPOSE_WGSL,
} from '../../inverseTransposeWgsl.ts';
import { campagne, construireCas, ecart, luminance } from './normaleEclairageCas.mjs';
import { eclairageGpu } from './normaleEclairageGpu.mjs';
import { substitueFormeAvant } from './substitutionAvant.mjs';

// Le texte d'avant le lot, remis dans le texte livré : même morceau que pour le défaut 6, et même
// garde — `substitutionAvant.mjs` échoue en nommant ce qui manque si le bloc n'est plus trouvé,
// apparaît deux fois, ou se recolle de travers. Un texte « différent » ne prouverait rien.
const AVANT = substitueFormeAvant({
  texte: NORMAL_TRANSFORM_WGSL,
  livre: INVERSE_TRANSPOSE_WGSL,
  avant: INVERSE_TRANSPOSE_AVANT_WGSL,
  nom: 'NORMAL_TRANSFORM_WGSL (standardLighting.ts)',
  origine: 'packages/sdk-browser/inverseTransposeWgsl.ts',
  marqueur: 'abs(det)<1e-20',
});

const cas = campagne();
const DECROCHE_DEG = 1e-3;

/** Balayage fin autour du seuil théorique s³ = 1e-20, soit s = 2,1544e-7, sur un cas représentatif. */
const BALAYAGE = [3e-7, 2.5e-7, 2.2e-7, 2.16e-7, 2.155e-7, 2.154e-7, 2.15e-7, 2.1e-7, 2e-7].map(
  (s) =>
    construireCas({
      s,
      kind: 'uniforme',
      axis: [0, 1, 0],
      angleDeg: 90,
      normale: [0, 0, 1],
      lumiere: [0.3, 0.8, 0.5, 3],
      metal: 0.1,
      rugosite: 0.4,
    }),
);

async function mesure(transform, liste = cas) {
  const gpu = await eclairageGpu(liste, transform);
  assert.equal(gpu.indisponible ?? null, null, String(gpu.indisponible));
  assert.deepEqual(gpu.compilation ?? [], [], 'compilation WGSL');
  assert.deepEqual(gpu.erreurs ?? [], [], 'erreurs WebGPU');
  return {
    adaptateur: gpu.adaptateur,
    lignes: gpu.lignes,
    ecarts: liste.map((c, i) => ecart(c, gpu.lignes[i])),
  };
}

const avant = await mesure(AVANT);
const apres = await mesure(NORMAL_TRANSFORM_WGSL);
const seuil = await mesure(AVANT, BALAYAGE);

const parEchelle = new Map();
for (let i = 0; i < cas.length; i++) {
  const ligne = parEchelle.get(cas[i].s) ?? { s: cas[i].s, avant: 0, apres: 0, pireAvant: 0 };
  if (avant.ecarts[i].angleDeg > DECROCHE_DEG) ligne.avant++;
  if (apres.ecarts[i].angleDeg > DECROCHE_DEG) ligne.apres++;
  ligne.pireAvant = Math.max(ligne.pireAvant, avant.ecarts[i].angleDeg);
  parEchelle.set(cas[i].s, ligne);
}
const pire = (m, cle = 'angleDeg') => m.ecarts.reduce((x, e) => Math.max(x, e[cle]), 0);
const compte = (m) => m.ecarts.filter((e) => e.angleDeg > DECROCHE_DEG).length;

// Non-régression : hors de la bande du seuil (s ≥ 1e-6), la couleur éclairée d'avant le lot et
// celle du texte livré se comparent case à case. L'arithmétique touche chaque pixel ombré.
const ordinaire = cas.map((c, i) => i).filter((i) => cas[i].s >= 1e-6);
const angleEntre = (a, b) => {
  const u = (v) => v.map((x) => x / Math.hypot(...v));
  const [p, q] = [u(a), u(b)];
  const d = p.reduce((acc, x, k) => acc + x * q[k], 0);
  return (Math.acos(Math.min(1, Math.max(-1, d))) * 180) / Math.PI;
};
const nonRegression = ordinaire.reduce(
  (acc, i) => {
    const [a, b] = [avant.lignes[i], apres.lignes[i]];
    const [la, lb] = [luminance(a.litRendu), luminance(b.litRendu)];
    return {
      cas: acc.cas + 1,
      identiques: acc.identiques + (a.litRendu.every((x, k) => x === b.litRendu[k]) ? 1 : 0),
      pireAngleDeg: Math.max(acc.pireAngleDeg, angleEntre(a.rendue, b.rendue)),
      pireEcartLuminance: Math.max(acc.pireEcartLuminance, Math.abs(la - lb) / Math.max(la, 1e-6)),
    };
  },
  { cas: 0, identiques: 0, pireAngleDeg: 0, pireEcartLuminance: 0 },
);

console.log(
  JSON.stringify(
    {
      adaptateur: apres.adaptateur,
      cas: cas.length,
      decrochages: { avant: compte(avant), apres: compte(apres) },
      pireAngleDeg: { avant: pire(avant), apres: pire(apres) },
      pireEcartLuminance: {
        avant: pire(avant, 'ecartLuminance'),
        apres: pire(apres, 'ecartLuminance'),
      },
      parEchelle: [...parEchelle.values()],
      nonRegression,
      seuilAvantLeLot: seuil.ecarts.map((e) => ({ s: e.s, angleDeg: e.angleDeg })),
    },
    null,
    2,
  ),
);

assert.equal(compte(apres), 0, 'le texte livré doit suivre la rotation à toute échelle');
assert.ok(compte(avant) > 0, 'le défaut 9 ne se reproduit plus : campagne à revoir');
assert.ok(
  nonRegression.pireEcartLuminance < 1e-5,
  `à échelle ordinaire l'éclairage a bougé de ${nonRegression.pireEcartLuminance}`,
);
console.log('OK : le texte livré ne décroche sur aucun cas, celui d’avant le lot décrochait.');
