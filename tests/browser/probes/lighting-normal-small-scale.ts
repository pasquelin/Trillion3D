// Defect 9: in `NORMAL_TRANSFORM_WGSL` (standardLighting.ts), the `abs(det)<1e-20` guard bore
// on the RAW determinant of the world 3×3. A uniform-scale rotation s has determinant ±s³: from
// s ≲ 2.15e-7, `inverseTranspose3` yielded the LOCAL, unrotated normal — the surface was lit as
// if it had not rotated. Same defect as 6, another file; fixed by sharing the text
// (`inverseTransposeWgsl.ts`) instead of rewriting a variant.
//
// The campaign runs the SAME shader twice in Chromium WebGPU — reconstructed pre-batch text,
// then shipped text — on the same cases, and measures the angle between the rendered normal and
// the true normal (Three in f64) as well as the relative luminance discrepancy of the same BRDF.
//
// node --experimental-strip-types \
//   tests/browser/probes/lighting-normal-small-scale.ts
import assert from 'node:assert/strict';
import { NORMAL_TRANSFORM_WGSL } from '../../../packages/sdk-browser/src/lighting/standardLighting.ts';
import {
  INVERSE_TRANSPOSE_BEFORE_WGSL,
  INVERSE_TRANSPOSE_WGSL,
} from '../../../packages/sdk-browser/src/math/inverseTransposeWgsl.ts';
import { campagne, construireCas, ecart, luminance } from './lightingNormalCases.ts';
import type { CasNormale } from './lightingNormalCases.ts';
import { eclairageGpu } from './lightingNormalGpu.ts';
import { substitueFormeAvant } from './substitutionBefore.ts';

// Pre-batch text, put back into the shipped text: same fragment as for defect 6, and same
// guard — `substitutionBefore.ts` fails naming what is missing if the block is no longer found,
// appears twice, or is glued back crooked. A "different" text would prove nothing.
const AVANT = substitueFormeAvant({
  texte: NORMAL_TRANSFORM_WGSL,
  livre: INVERSE_TRANSPOSE_WGSL,
  before: INVERSE_TRANSPOSE_BEFORE_WGSL,
  name: 'NORMAL_TRANSFORM_WGSL (standardLighting.ts)',
  origine: 'packages/sdk-browser/src/math/inverseTransposeWgsl.ts',
  marqueur: 'abs(det)<1e-20',
});

const cas = campagne();
const DECROCHE_DEG = 1e-3;

/** Fine sweep around the theoretical threshold s³ = 1e-20, i.e. s = 2.1544e-7, on a representative case. */
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

async function mesure(transform: string, liste: CasNormale[] = cas) {
  const gpu = await eclairageGpu(liste, { transform });
  assert.equal(gpu.indisponible ?? null, null, String(gpu.indisponible));
  assert.deepEqual(gpu.compilation ?? [], [], 'compilation WGSL');
  assert.deepEqual(gpu.erreurs ?? [], [], 'erreurs WebGPU');
  return {
    adaptateur: gpu.adaptateur,
    lignes: gpu.lignes,
    ecarts: liste.map((c, i) => ecart(c, gpu.lignes[i])),
  };
}

const before = await mesure(AVANT);
const after = await mesure(NORMAL_TRANSFORM_WGSL);
const seuil = await mesure(AVANT, BALAYAGE);

type Resultat = Awaited<ReturnType<typeof mesure>>;

const parEchelle = new Map<
  number,
  { s: number; before: number; after: number; pireAvant: number }
>();
for (let i = 0; i < cas.length; i++) {
  const ligne = parEchelle.get(cas[i].s) ?? { s: cas[i].s, before: 0, after: 0, pireAvant: 0 };
  if (before.ecarts[i].angleDeg > DECROCHE_DEG) ligne.before++;
  if (after.ecarts[i].angleDeg > DECROCHE_DEG) ligne.after++;
  ligne.pireAvant = Math.max(ligne.pireAvant, before.ecarts[i].angleDeg);
  parEchelle.set(cas[i].s, ligne);
}
const pire = (m: Resultat, cle: 'angleDeg' | 'ecartLuminance' = 'angleDeg'): number =>
  m.ecarts.reduce((x, e) => Math.max(x, e[cle]), 0);
const compte = (m: Resultat): number => m.ecarts.filter((e) => e.angleDeg > DECROCHE_DEG).length;

// Non-regression: outside the threshold band (s ≥ 1e-6), the pre-batch lit colour and that of
// the shipped text are compared case by case. The arithmetic touches every shaded pixel.
const ordinaire = cas.map((c, i) => i).filter((i) => cas[i].s >= 1e-6);
const angleEntre = (a: number[], b: number[]): number => {
  const u = (v: number[]): number[] => v.map((x) => x / Math.hypot(...v));
  const [p, q] = [u(a), u(b)];
  const d = p.reduce((acc, x, k) => acc + x * q[k], 0);
  return (Math.acos(Math.min(1, Math.max(-1, d))) * 180) / Math.PI;
};
const nonRegression = ordinaire.reduce(
  (acc, i) => {
    const [a, b] = [before.lignes[i], after.lignes[i]];
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
      adaptateur: after.adaptateur,
      cas: cas.length,
      decrochages: { before: compte(before), after: compte(after) },
      pireAngleDeg: { before: pire(before), after: pire(after) },
      pireEcartLuminance: {
        before: pire(before, 'ecartLuminance'),
        after: pire(after, 'ecartLuminance'),
      },
      parEchelle: [...parEchelle.values()],
      nonRegression,
      seuilAvantLeLot: seuil.ecarts.map((e) => ({ s: e.s, angleDeg: e.angleDeg })),
    },
    null,
    2,
  ),
);

assert.equal(compte(after), 0, 'the shipped text must follow the rotation at every scale');
assert.ok(compte(before) > 0, 'defect 9 no longer reproduces: campaign to review');
assert.ok(
  nonRegression.pireEcartLuminance < 1e-5,
  `at ordinary scale lighting moved by ${nonRegression.pireEcartLuminance}`,
);
console.log('OK: the shipped text drifts on no case, the pre-batch one did.');
