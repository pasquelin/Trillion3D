// Banc d'équivalence du lot « formules communes TS ».
import { DEFAULT_PIXEL_RATIO, devicePixels } from '../backendCommon.ts';
import { bounceBatchOf, frustumExcludesBox } from '../../sdk-core/index.ts';
import { nanosecondsToMs } from '../gpuTimingTypes.ts';
import { VIS_TRIANGLE_BITS } from '../visibilityTypes.ts';
import { barycentric } from '../visibilityMath.ts';
import { barycentricAt, signedArea } from '../visibilityProjection.ts';
import { packedRowBase } from '../webgpuPageRow.ts';
import { plancherDuModele } from '../../../scripts/mesure/poses.mjs';
import { mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import {
  referenceBarycentric,
  referenceBounceBatch,
  referenceDevicePixels,
  referenceFloorOf,
  referenceNsToMs,
  referenceOutsidePlanes,
  referencePackedRowBase,
  referenceSignedArea,
  referenceWeights,
} from './oracles/formules-ts.mjs';
import { casPlans, durees, emprises, lots, rangs, tailles, triangles } from './scenesFormules.mjs';

const un = (nom, entree, taille) => [{ nom, entree, taille }];
const options = { chauffe: 2, tours: 12, budgetMs: 500 };

const resPlanes = await mesure({
  nom: 'boîte hors des six plans',
  fichier: 'packages/sdk-core/mathFrustumBox.ts',
  cas: un('400 jeux de plans × 400 boîtes hostiles', casPlans, casPlans.length),
  calcul: (liste) => liste.map((c) => frustumExcludesBox(c.planes, ...c.boite)),
  attendu: (liste) => liste.map((c) => referenceOutsidePlanes(c.planes, ...c.boite)),
  options,
});

const resArea = await mesure({
  nom: 'aire signée du triangle écran',
  fichier: 'packages/sdk-browser/visibilityProjection.ts',
  cas: un('3 000 triangles hostiles', triangles, triangles.length),
  calcul: (liste) => liste.map((t) => signedArea(t.a, t.b, t.c)),
  attendu: (liste) => liste.map((t) => referenceSignedArea(t.a, t.b, t.c)),
  options,
});

const resWeights = await mesure({
  nom: 'poids barycentriques affines',
  fichier: 'packages/sdk-browser/visibilityProjection.ts',
  cas: un('3 000 triangles hostiles', triangles, triangles.length),
  calcul: (liste) => {
    const sortie = new Float64Array(liste.length * 3);
    for (let i = 0; i < liste.length; i++) {
      const t = liste[i];
      const p = barycentricAt(t.a, t.b, t.c, t.x, t.y, signedArea(t.a, t.b, t.c));
      sortie[i * 3] = p.w0;
      sortie[i * 3 + 1] = p.w1;
      sortie[i * 3 + 2] = p.w2;
    }
    return sortie;
  },
  attendu: (liste) => {
    const sortie = new Float64Array(liste.length * 3);
    for (let i = 0; i < liste.length; i++) {
      const t = liste[i];
      const p = referenceWeights(t.a, t.b, t.c, t.x, t.y, referenceSignedArea(t.a, t.b, t.c));
      sortie[i * 3] = p.w0;
      sortie[i * 3 + 1] = p.w1;
      sortie[i * 3 + 2] = p.w2;
    }
    return sortie;
  },
  options,
});

const resBary = await mesure({
  nom: 'barycentriques visbuffer',
  fichier: 'packages/sdk-browser/visibilityMath.ts',
  cas: un('3 000 triangles hostiles', triangles, triangles.length),
  calcul: (liste) => liste.map((t) => barycentric(t.a, t.b, t.c, t.x, t.y)),
  attendu: (liste) => liste.map((t) => referenceBarycentric(t.a, t.b, t.c, t.x, t.y)),
  options,
});

const resRow = await mesure({
  nom: "socle d'identifiant de ligne",
  fichier: 'packages/sdk-browser/webgpuPageRow.ts',
  cas: un('2 000 rangs', rangs, rangs.length),
  calcul: (liste) => liste.map((row) => packedRowBase(row)),
  attendu: (liste) => liste.map((row) => referencePackedRowBase(row, VIS_TRIANGLE_BITS)),
  options,
});

const resBatch = await mesure({
  nom: 'lot budget millisecondes',
  fichier: 'packages/sdk-core/bounceBudget.ts',
  cas: un('2 000 plafonds et charges', lots, lots.length),
  calcul: (liste) => liste.map((l) => bounceBatchOf(l.ceiling, l.load)),
  attendu: (liste) => liste.map((l) => referenceBounceBatch(l.ceiling, l.load)),
  options,
});

const resPixels = await mesure({
  nom: "pixels d'appareil dimension logique",
  fichier: 'packages/sdk-browser/backendCommon.ts',
  cas: un('2 000 tailles et rapports', tailles, tailles.length),
  calcul: (liste) => liste.map((t) => devicePixels(t.logical, t.ratio)),
  attendu: (liste) =>
    liste.map((t) => referenceDevicePixels(t.logical, t.ratio, DEFAULT_PIXEL_RATIO)),
  options,
});

const resNs = await mesure({
  nom: 'nanosecondes vers millisecondes',
  fichier: 'packages/sdk-browser/gpuTimingTypes.ts',
  cas: un('2 000 durées', durees, durees.length),
  calcul: (liste) => liste.map((ns) => nanosecondsToMs(ns)),
  attendu: (liste) => liste.map((ns) => referenceNsToMs(ns)),
  options,
});

const resFloor = await mesure({
  nom: 'plancher du modèle',
  fichier: 'scripts/mesure/poses.mjs',
  cas: un('1 000 emprises', emprises, emprises.length),
  calcul: (liste) => liste.map((b) => plancherDuModele(b)),
  attendu: (liste) => liste.map((b) => referenceFloorOf(b)),
  options,
});

await stress({
  nom: 'devicePixels extremes',
  calcul: ([l, r]) => devicePixels(l, r),
  extremes: [{ nom: 'zero', entree: [0, 1] }, { nom: 'ratio 0', entree: [100, 0] }],
});

rapport(
  'formules-ts',
  [resPlanes, resArea, resWeights, resBary, resRow, resBatch, resPixels, resNs, resFloor],
  'chaque formule commune rend exactement ce que rendaient les copies qu elle remplace',
);
