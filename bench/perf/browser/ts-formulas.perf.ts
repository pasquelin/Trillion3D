// Equivalence bench for the "shared TS formulas" batch.
import {
  DEFAULT_PIXEL_RATIO,
  devicePixels,
} from '../../../packages/sdk-browser/src/backend/common.ts';
import { frustumExcludesBox } from '../../../packages/sdk-core/src/index.ts';
import { nanosecondsToMs } from '../../../packages/sdk-browser/src/gpu/timing/types.ts';
import { VIS_TRIANGLE_BITS } from '../../../packages/sdk-browser/src/visibility/types.ts';
import { signedArea } from '../../../packages/sdk-browser/src/visibility/projection.ts';
import { packedRowBase } from '../../../packages/sdk-browser/src/webgpu/row/pageRow.ts';
import { modelFloor } from '../../runner/poses.ts';
import { mesure, parElement, stress, rapport } from '../../core/index.ts';
import {
  referenceDevicePixels,
  referenceFloorOf,
  referenceNsToMs,
  referenceOutsidePlanes,
  referencePackedRowBase,
  referenceSignedArea,
} from '../../oracles/browser/ts-formulas.ts';
import { casPlans, durees, emprises, rangs, tailles, triangles } from './support/scenesFormulas.ts';
import type { MesureCas } from '../../core/index.ts';

const single = <Entree>(name: string, input: Entree, size: number): MesureCas<Entree>[] => [
  { name, input, size },
];
const options = { tours: 100, budgetMs: 500 };
type Triangle = (typeof triangles)[number];

const resPlanes = await mesure({
  name: 'box outside the six planes',
  fichier: 'packages/sdk-core/src/math/frustum/box.ts',
  cas: single('400 plane sets × 400 hostile boxes', casPlans, casPlans.length),
  calcul: parElement((c: (typeof casPlans)[number]) =>
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
  fichier: 'packages/sdk-browser/src/visibility/projection.ts',
  cas: single('3 000 hostile triangles', triangles, triangles.length),
  calcul: parElement((t: Triangle) => signedArea(t.a, t.b, t.c)),
  attendu: (liste) => liste.map((t) => referenceSignedArea(t.a, t.b, t.c)),
  options,
});

const resRow = await mesure({
  name: 'row-identifier foundation',
  fichier: 'packages/sdk-browser/src/webgpu/row/pageRow.ts',
  cas: single('2 000 ranks', rangs, rangs.length),
  calcul: parElement((row: number) => packedRowBase(row)),
  attendu: (liste) => liste.map((row) => referencePackedRowBase(row, VIS_TRIANGLE_BITS)),
  options,
});

const resPixels = await mesure({
  name: 'device pixels from logical size',
  fichier: 'packages/sdk-browser/src/backend/common.ts',
  cas: single('2 000 sizes and ratios', tailles, tailles.length),
  calcul: parElement((t: (typeof tailles)[number]) => devicePixels(t.logical, t.ratio)),
  attendu: (liste) =>
    liste.map((t) => referenceDevicePixels(t.logical, t.ratio, DEFAULT_PIXEL_RATIO)),
  options,
});

const resNs = await mesure({
  name: 'nanoseconds to milliseconds',
  fichier: 'packages/sdk-browser/src/gpu/timing/types.ts',
  cas: single('2 000 durations', durees, durees.length),
  calcul: parElement((ns: number) => nanosecondsToMs(ns)),
  attendu: (liste) => liste.map((ns) => referenceNsToMs(ns)),
  options,
});

const resFloor = await mesure({
  name: 'model floor',
  fichier: 'bench/runner/poses.ts',
  cas: single('1 000 extents', emprises, emprises.length),
  calcul: parElement((b: (typeof emprises)[number]) => modelFloor(b)),
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
  [resPlanes, resArea, resRow, resPixels, resNs, resFloor],
  'each shared formula yields exactly what the copies it replaces used to yield',
);
