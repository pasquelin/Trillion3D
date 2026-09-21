// Equivalence bench for the "shared TS formulas" batch.
import { DEFAULT_PIXEL_RATIO, devicePixels } from '../backendCommon.ts';
import { frustumExcludesBox } from '../../sdk-core/index.ts';
import { nanosecondsToMs } from '../gpuTimingTypes.ts';
import { VIS_TRIANGLE_BITS } from '../visibilityTypes.ts';
import { barycentric } from '../visibilityMath.ts';
import { barycentricAt, signedArea } from '../visibilityProjection.ts';
import { packedRowBase } from '../webgpuPageRow.ts';
import { plancherDuModele } from '../../../scripts/mesure/poses.ts';
import { mesure, stress, rapport } from '../../sdk-core/bench/socle.ts';
import {
  referenceBarycentric,
  referenceDevicePixels,
  referenceFloorOf,
  referenceNsToMs,
  referenceOutsidePlanes,
  referencePackedRowBase,
  referenceSignedArea,
  referenceWeights,
} from './oracles/formules-ts.ts';
import { casPlans, durees, emprises, rangs, tailles, triangles } from './appui/scenesFormules.ts';
import type { MesureCas } from '../../sdk-core/bench/socle.ts';

const un = <Entree>(name: string, input: Entree, size: number): MesureCas<Entree>[] => [
  { name, input, size },
];
const options = { chauffe: 2, tours: 12, budgetMs: 500 };

const resPlanes = await mesure({
  name: 'box outside the six planes',
  fichier: 'packages/sdk-core/mathFrustumBox.ts',
  cas: un('400 plane sets × 400 hostile boxes', casPlans, casPlans.length),
  calcul: (liste) =>
    liste.map((c) =>
      frustumExcludesBox(
        c.planes,
        c.boite[0],
        c.boite[1],
        c.boite[2],
        c.boite[3],
        c.boite[4],
        c.boite[5],
      ),
    ),
  attendu: (liste) =>
    liste.map((c) =>
      referenceOutsidePlanes(
        c.planes,
        c.boite[0],
        c.boite[1],
        c.boite[2],
        c.boite[3],
        c.boite[4],
        c.boite[5],
      ),
    ),
  options,
});

const resArea = await mesure({
  name: 'signed screen-triangle area',
  fichier: 'packages/sdk-browser/visibilityProjection.ts',
  cas: un('3 000 hostile triangles', triangles, triangles.length),
  calcul: (liste) => liste.map((t) => signedArea(t.a, t.b, t.c)),
  attendu: (liste) => liste.map((t) => referenceSignedArea(t.a, t.b, t.c)),
  options,
});

const resWeights = await mesure({
  name: 'affine barycentric weights',
  fichier: 'packages/sdk-browser/visibilityProjection.ts',
  cas: un('3 000 hostile triangles', triangles, triangles.length),
  calcul: (liste) => {
    const output = new Float64Array(liste.length * 3);
    for (let i = 0; i < liste.length; i++) {
      const t = liste[i];
      const p = barycentricAt(t.a, t.b, t.c, t.x, t.y, signedArea(t.a, t.b, t.c));
      output[i * 3] = p.w0;
      output[i * 3 + 1] = p.w1;
      output[i * 3 + 2] = p.w2;
    }
    return output;
  },
  attendu: (liste) => {
    const output = new Float64Array(liste.length * 3);
    for (let i = 0; i < liste.length; i++) {
      const t = liste[i];
      const p = referenceWeights(t.a, t.b, t.c, t.x, t.y, referenceSignedArea(t.a, t.b, t.c));
      output[i * 3] = p.w0;
      output[i * 3 + 1] = p.w1;
      output[i * 3 + 2] = p.w2;
    }
    return output;
  },
  options,
});

const resBary = await mesure({
  name: 'barycentriques visbuffer',
  fichier: 'packages/sdk-browser/visibilityMath.ts',
  cas: un('3 000 hostile triangles', triangles, triangles.length),
  calcul: (liste) => liste.map((t) => barycentric(t.a, t.b, t.c, t.x, t.y)),
  attendu: (liste) => liste.map((t) => referenceBarycentric(t.a, t.b, t.c, t.x, t.y)),
  options,
});

const resRow = await mesure({
  name: 'row-identifier foundation',
  fichier: 'packages/sdk-browser/webgpuPageRow.ts',
  cas: un('2 000 ranks', rangs, rangs.length),
  calcul: (liste) => liste.map((row) => packedRowBase(row)),
  attendu: (liste) => liste.map((row) => referencePackedRowBase(row, VIS_TRIANGLE_BITS)),
  options,
});

const resPixels = await mesure({
  name: 'device pixels from logical size',
  fichier: 'packages/sdk-browser/backendCommon.ts',
  cas: un('2 000 sizes and ratios', tailles, tailles.length),
  calcul: (liste) => liste.map((t) => devicePixels(t.logical, t.ratio)),
  attendu: (liste) =>
    liste.map((t) => referenceDevicePixels(t.logical, t.ratio, DEFAULT_PIXEL_RATIO)),
  options,
});

const resNs = await mesure({
  name: 'nanoseconds to milliseconds',
  fichier: 'packages/sdk-browser/gpuTimingTypes.ts',
  cas: un('2 000 durations', durees, durees.length),
  calcul: (liste) => liste.map((ns) => nanosecondsToMs(ns)),
  attendu: (liste) => liste.map((ns) => referenceNsToMs(ns)),
  options,
});

const resFloor = await mesure({
  name: 'model floor',
  fichier: 'scripts/mesure/poses.ts',
  cas: un('1 000 extents', emprises, emprises.length),
  calcul: (liste) => liste.map((b) => plancherDuModele(b)),
  attendu: (liste) => liste.map((b) => referenceFloorOf(b)),
  options,
});

await stress({
  name: 'devicePixels extremes',
  calcul: ([l, r]) => devicePixels(l, r),
  extremes: [
    { name: 'zero', input: [0, 1] },
    { name: 'ratio 0', input: [100, 0] },
  ],
});

rapport(
  'formules-ts',
  [resPlanes, resArea, resWeights, resBary, resRow, resPixels, resNs, resFloor],
  'each shared formula yields exactly what the copies it replaces used to yield',
);
