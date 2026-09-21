// Defect 6: in `inverseTranspose3` (gpuDagShader.ts), the `abs(det)<1e-20` guard returned the
// untransformed LOCAL axis instead of the inverse-transpose as soon as a small enough uniform
// scale (det = ±s³ < 1e-20, i.e. s ≲ 2.15e-7) made the determinant tiny. The conformance test
// (defect 1) being scale-independent, a tiny-scale rotation was judged conforming on both
// sides and only the GPU took the shortcut: it compared the unrotated axis to the camera as
// if it were already in world space, and culled faces that were still front-facing.
//
// This script actually runs the WGSL kernel in Chromium WebGPU, twice on the same cases:
// the fixed version as shipped, and the PREVIOUS version rebuilt by `substitutionAvant.ts`,
// which establishes the substitution instead of hoping for it.
//
// TWO POPULATIONS UNDER ONE WORD. "560 culls before, 54 after" proves nothing on its own:
// culling a face can be CORRECT (the engine does not draw it) or WRONG (it does), and those
// two counts used to be read on `veriteTerrain`, the RAW geometric orientation, which ignores
// that the engine swaps the culled face under reflection. This bench now compares each cull
// to the true-orientation oracle — actual rasterisation of the same cases with the engine's
// face state (`inverseTransposeOracle.ts`) — and publishes the populations separately.
//
// node --experimental-strip-types \
//   test/justesse/inverse-transposee-petite-echelle.ts
import assert from 'node:assert/strict';
import { cameraSelectionUniforms } from '../../packages/sdk-browser/gpuSelection.ts';
import { DAG_SELECTION_SHADER } from '../../packages/sdk-browser/gpuDagShader.ts';
import {
  INVERSE_TRANSPOSE_BEFORE_WGSL,
  INVERSE_TRANSPOSE_WGSL,
} from '../../packages/sdk-browser/inverseTransposeWgsl.ts';
import {
  vue,
  VIEWPORT,
  dansLeChamp,
  decisionCpu,
  empaqueteCas,
  veriteTerrain,
} from './inverseTransposeCas.ts';
import { DETERMINISTES, HORS_BANDE, SCALES, tousLesCas } from './inverseTransposeEchantillon.ts';
import { classement, dessineParLeMoteur } from './inverseTransposeOracle.ts';
import { selectionGpu } from './noyauSelectionGpu.ts';
import { substitueFormeAvant } from './substitutionAvant.ts';
import type { Resultat } from './noyauSelectionGpuPack.ts';

// --- Pre-batch text, put back into the shipped shader -------------------------------------------
// Both texts come from `inverseTransposeWgsl.ts`: the bench rewrites neither the corrected
// threshold nor the old one, or it would replay its own variant of the defect, not the defect.
const SHADER_AVANT = substitueFormeAvant({
  texte: DAG_SELECTION_SHADER,
  livre: INVERSE_TRANSPOSE_WGSL,
  before: INVERSE_TRANSPOSE_BEFORE_WGSL,
  name: 'DAG_SELECTION_SHADER (gpuDagShader.ts)',
  origine: 'packages/sdk-browser/inverseTransposeWgsl.ts',
  marqueur: 'abs(det)<1e-20',
});

// --- CPU, raw truth and engine oracle ------------------------------------------------------------
const verites = tousLesCas.map(veriteTerrain);
const cpus = tousLesCas.map(decisionCpu);
const champs = tousLesCas.map(dansLeChamp);
const moteur = await dessineParLeMoteur(tousLesCas);

// --- GPU actually executed, one dispatch batch per version ---------------------------------------
const uniforms = cameraSelectionUniforms(vue, 0, VIEWPORT);
const packed = empaqueteCas(tousLesCas);

/** Pages rejected by the WGSL kernel, for a given shader text. */
async function rejetsGpu(shader: string) {
  const gpu = await selectionGpu([{ name: 'lot', packed, uniforms }], shader);
  assert.equal(gpu.indisponible ?? null, null, `GPU unavailable: ${gpu.indisponible}`);
  assert.deepEqual([...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])], [], 'WGSL');
  const lot: Resultat | undefined = gpu.resultats?.find((r) => r.name === 'lot');
  assert.ok(lot, `${shader}: no "lot" result`);
  const gardees = new Set(lot.pages);
  return { adaptateur: gpu.adaptateur, rejets: tousLesCas.map((_, i) => !gardees.has(i)) };
}
const before = await rejetsGpu(SHADER_AVANT);
const after = await rejetsGpu(DAG_SELECTION_SHADER);

// --- Classification: the populations, kept apart -------------------------------------------------
const { index, fausses, population } = classement({ cas: tousLesCas, verites, moteur });
const popAvant = population(before.rejets);
const popApres = population(after.rejets);
const changements = index.filter((i) => before.rejets[i] !== after.rejets[i]);
const aCetteEchelle = (s: number, liste: number[]): number =>
  liste.filter((i) => tousLesCas[i].s === s).length;
const parEchelle = Object.fromEntries(
  SCALES.map((s) => [
    s,
    {
      cas: aCetteEchelle(s, index),
      faussesAvant: aCetteEchelle(s, fausses(before.rejets)),
      faussesApres: aCetteEchelle(s, fausses(after.rejets)),
      selectionsChangees: aCetteEchelle(s, changements),
    },
  ]),
);

console.log(
  JSON.stringify(
    {
      adaptateurGpu: after.adaptateur,
      adaptateurOracle: moteur.adaptateur,
      totalCas: tousLesCas.length,
      dessinesParLeMoteur: moteur.dessine.filter(Boolean).length,
      suppressionsAvant: popAvant,
      suppressionsApres: popApres,
      selectionsChangees: changements.length,
      parEchelle,
      contreExemple: {
        cas: DETERMINISTES[0][1],
        dansLeChamp: champs[0],
        verite: verites[0],
        fragmentsDuMoteur: moteur.fragments[0],
        cpu: cpus[0],
        gpuAvant: before.rejets[0],
        gpuApres: after.rejets[0],
      },
      temoins: DETERMINISTES.slice(1).map(([name], k) => ({
        name,
        verite: verites[k + 1].avantVisible,
        fragmentsDuMoteur: moteur.fragments[k + 1],
        cpuRejette: cpus[k + 1].coneRejette,
        gpuAvant: before.rejets[k + 1],
        gpuApres: after.rejets[k + 1],
      })),
    },
    null,
    2,
  ),
);

// --- The counter-example: the defect, then its disappearance -------------------------------------
const nettementDeFace = (t: { face: number; airePixels: number }): boolean =>
  t.face > 0.5 && t.airePixels > 100;
assert.ok(champs[0], 'the counter-example must be in the field of view');
assert.ok(verites[0].triangles.every(nettementDeFace), 'both triangles must be front-facing');
assert.ok(moteur.fragments[0] > 0, 'the counter-example must be drawn by the engine itself');
assert.equal(cpus[0].conforme, true, 'CPU: the transform must be judged conforming');
assert.equal(cpus[0].rejette, false, 'CPU: selectVisiblePages must keep both triangles');
assert.equal(before.rejets[0], true, 'before: WGSL culled the visible cluster');
assert.equal(after.rejets[0], false, 'after: WGSL keeps the visible cluster');

// --- The populations, each held separately -------------------------------------------------------
assert.ok(
  popAvant.fausses > 0,
  'the defect must show against the engine oracle, not only against raw truth',
);
assert.equal(
  popApres.fausses,
  0,
  `after the batch, ${popApres.fausses} cluster(s) the engine draws are still culled`,
);
assert.equal(
  popApres.brutes,
  popApres.brutesNonDessinees,
  `the ${popApres.brutes} remaining culls must all be faces the engine does not ` +
    'draw; raw truth alone cannot judge',
);
// The old count partitions exactly, and a whole share was missing: the two classification
// invariants, held on both sides, say in numbers that "560" and "54" did not measure
// what they claimed.
for (const [name, pop] of [
  ['before', popAvant],
  ['after', popApres],
] as const) {
  assert.equal(
    pop.brutes,
    pop.brutesDessinees + pop.brutesNonDessinees,
    `${name}: the raw-truth count does not partition`,
  );
  assert.equal(
    pop.fausses,
    pop.brutesDessinees + pop.manqueesParLaVeriteBrute,
    `${name}: the true-cull count does not partition`,
  );
}
assert.ok(
  popAvant.brutesNonDessinees > 0 && popAvant.manqueesParLaVeriteBrute > 0,
  'the old count was wrong both ways: if it stops being, say so here',
);

// --- What the batch must not change --------------------------------------------------------------
assert.deepEqual(
  changements.filter((i) => HORS_BANDE.includes(tousLesCas[i].s)),
  [],
  'outside the threshold band (det ≥ 1e-20), no selection may change',
);
assert.equal(after.rejets[1], false, 'large-scale witness: det ≫ 1e-20, the GPU keeps');
assert.equal(verites[2].avantVisible, false, 'no-rotation: faces are back-facing');
assert.equal(moteur.fragments[2], 0, 'no-rotation witness: the engine draws none of them');
assert.equal(after.rejets[2], true, 'no-rotation witness: the legitimate cull must be kept');
assert.equal(after.rejets[3], false, 'non-conforming witness: never culled, whatever the rotation');

console.error(
  `Verdict: defect 6 REAL — measured against what the engine DRAWS, ${popAvant.fausses} clusters ` +
    `of ${tousLesCas.length} were culled before the batch, ${popApres.fausses} after. ` +
    `The old count, "${popAvant.brutes} before, ${popApres.brutes} after", read RAW ` +
    `truth: before the batch it counted ${popAvant.brutesNonDessinees} legitimate culls ` +
    `as defects and missed ${popAvant.manqueesParLaVeriteBrute} that were. ` +
    `0 selection changed outside the band, ${moteur.dessine.filter(Boolean).length} clusters ` +
    `drawn of ${tousLesCas.length}. Kernel ${after.adaptateur}, oracle ${moteur.adaptateur}.`,
);
