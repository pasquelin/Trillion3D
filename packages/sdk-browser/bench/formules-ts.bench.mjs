// Banc d'équivalence du lot « formules communes TS ». Il ne cherche aucun gain : il oppose chaque
// fonction commune à la copie qu'elle remplace, sur les entrées hostiles de `scenesFormules.mjs`,
// et la ligne tombe au premier bit d'écart.
//
// La colonne « retenu » du tableau commun dit qu'une ligne est plus rapide qu'avant : ce n'est pas
// le critère ici. Seule la colonne « identique » décide, et l'assertion de dépôt la fait tomber.
// Les durées mesurées sont celles de `map` sur quelques milliers d'entrées, pas celles du moteur.
import { DEFAULT_PIXEL_RATIO, devicePixels } from '../backendCommon.ts';
import { bounceBatchOf } from '../../sdk-core/index.ts';
import { outsidePlanes, projectedError } from '../gpuDagOracleMath.ts';
import { nanosecondsToMs } from '../gpuTimingTypes.ts';
import { viewDistance, viewDistanceOf } from '../pageSelectionProjection.ts';
import { VIS_TRIANGLE_BITS } from '../visibilityTypes.ts';
import { barycentric } from '../visibilityMath.ts';
import { barycentricAt, signedArea } from '../visibilityProjection.ts';
import { packedRowBase } from '../webgpuPageRow.ts';
import { plancherDuModele } from '../../../scripts/mesure/poses.mjs';
import { compare } from '../../sdk-core/bench/banc.mjs';
import { verifieEtDeposeFormules } from '../../sdk-core/bench/bancFormules.mjs';
import {
  referenceBarycentric,
  referenceBounceBatch,
  referenceDevicePixels,
  referenceFloorOf,
  referenceNsToMs,
  referenceOutsidePlanes,
  referencePackedRowBase,
  referenceProjectedError,
  referenceSignedArea,
  referenceViewDistance,
  referenceWeights,
} from './oracles/formules-ts.mjs';
import {
  casPlans,
  casProjection,
  durees,
  emprises,
  lots,
  rangs,
  tailles,
  triangles,
} from './scenesFormules.mjs';

const un = (nom, entree, taille) => [{ nom, entree, taille }];
const options = { chauffe: 2, tours: 12, budgetMs: 700 };

const lignes = [
  await compare({
    calcul: 'boîte hors des six plans',
    fichier: 'packages/sdk-browser/gpuDagOracleMath.ts',
    cas: un('400 jeux de plans × 400 boîtes hostiles', casPlans, casPlans.length),
    reference: (liste) => liste.map((c) => referenceOutsidePlanes(c.planes, ...c.boite)),
    optimisee: (liste) => liste.map((c) => outsidePlanes(c.planes, ...c.boite)),
    options,
  }),
  await compare({
    calcul: 'erreur projetée du DAG de clusters',
    fichier: 'packages/sdk-browser/gpuDagOracleMath.ts',
    cas: un('2 000 clusters, matrices hostiles', casProjection, casProjection.length),
    reference: (liste) =>
      liste.map((c) =>
        referenceProjectedError(
          c.error,
          c.sphere[0],
          c.sphere[1],
          c.sphere[2],
          c.sphere[3],
          c.e,
          c.stretch,
          c.focal,
          c.near,
        ),
      ),
    optimisee: (liste) =>
      liste.map((c) =>
        projectedError(
          c.error,
          c.sphere[0],
          c.sphere[1],
          c.sphere[2],
          c.sphere[3],
          c.e,
          c.stretch,
          c.focal,
          c.near,
        ),
      ),
    options,
  }),
  await compare({
    calcul: 'distance de vue du centre',
    fichier: 'packages/sdk-browser/pageSelectionProjection.ts',
    cas: un('2 000 sphères', casProjection, casProjection.length),
    reference: (liste) =>
      liste.map((c) => [
        referenceViewDistance(c.sphere, 0, c.e),
        referenceViewDistance(c.sphere, 0, c.e),
      ]),
    optimisee: (liste) =>
      liste.map((c) => [
        viewDistance(c.sphere, 0, c.e),
        viewDistanceOf(c.sphere[0], c.sphere[1], c.sphere[2], c.e),
      ]),
    options,
  }),
  await compare({
    calcul: 'aire signée du triangle écran',
    fichier: 'packages/sdk-browser/visibilityProjection.ts',
    cas: un('3 000 triangles hostiles', triangles, triangles.length),
    reference: (liste) => liste.map((t) => referenceSignedArea(t.a, t.b, t.c)),
    optimisee: (liste) => liste.map((t) => signedArea(t.a, t.b, t.c)),
    options,
  }),
  await compare({
    calcul: 'poids barycentriques affines',
    fichier: 'packages/sdk-browser/visibilityProjection.ts',
    cas: un('3 000 triangles hostiles', triangles, triangles.length),
    reference: (liste) => {
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
    optimisee: (liste) => {
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
    options,
  }),
  await compare({
    calcul: 'barycentriques du tampon de visibilité',
    fichier: 'packages/sdk-browser/visibilityMath.ts',
    cas: un('3 000 triangles hostiles', triangles, triangles.length),
    reference: (liste) => liste.map((t) => referenceBarycentric(t.a, t.b, t.c, t.x, t.y)),
    optimisee: (liste) => liste.map((t) => barycentric(t.a, t.b, t.c, t.x, t.y)),
    options,
  }),
  await compare({
    calcul: "socle d'identifiant de ligne",
    fichier: 'packages/sdk-browser/webgpuPageRow.ts',
    cas: un('2 000 rangs', rangs, rangs.length),
    reference: (liste) => liste.map((row) => referencePackedRowBase(row, VIS_TRIANGLE_BITS)),
    optimisee: (liste) => liste.map((row) => packedRowBase(row)),
    options,
  }),
  await compare({
    calcul: 'lot borné par le budget en millisecondes',
    fichier: 'packages/sdk-core/bounceBudget.ts',
    cas: un('2 000 plafonds et charges', lots, lots.length),
    reference: (liste) => liste.map((l) => referenceBounceBatch(l.ceiling, l.load)),
    optimisee: (liste) => liste.map((l) => bounceBatchOf(l.ceiling, l.load)),
    options,
  }),
  await compare({
    calcul: "pixels d'appareil d'une dimension logique",
    fichier: 'packages/sdk-browser/backendCommon.ts',
    cas: un('2 000 tailles et rapports', tailles, tailles.length),
    reference: (liste) =>
      liste.map((t) => referenceDevicePixels(t.logical, t.ratio, DEFAULT_PIXEL_RATIO)),
    optimisee: (liste) => liste.map((t) => devicePixels(t.logical, t.ratio)),
    options,
  }),
  await compare({
    calcul: 'nanosecondes vers millisecondes',
    fichier: 'packages/sdk-browser/gpuTimingTypes.ts',
    cas: un('2 000 durées', durees, durees.length),
    reference: (liste) => liste.map((ns) => referenceNsToMs(ns)),
    optimisee: (liste) => liste.map((ns) => nanosecondsToMs(ns)),
    options,
  }),
  await compare({
    calcul: 'plancher du modèle mesuré',
    fichier: 'scripts/mesure/poses.mjs',
    cas: un('1 000 emprises', emprises, emprises.length),
    reference: (liste) => liste.map((b) => referenceFloorOf(b)),
    optimisee: (liste) => liste.map((b) => plancherDuModele(b)),
    options,
  }),
];

verifieEtDeposeFormules(
  'formules-ts',
  'chaque formule commune rend exactement ce que rendaient les copies qu elle remplace',
  lignes,
);
