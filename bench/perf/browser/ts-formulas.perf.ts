// Equivalence bench for the "shared TS formulas" batch.
import {
  DEFAULT_PIXEL_RATIO,
  devicePixels,
} from '../../../packages/sdk-browser/src/backend/common.ts'
import { frustumExcludesBox } from '../../../packages/sdk-core/src/index.ts'
import { nanosecondsToMs } from '../../../packages/sdk-browser/src/gpu/timing/types.ts'
import { VIS_TRIANGLE_BITS } from '../../../packages/sdk-browser/src/visibility/types.ts'
import { signedArea } from '../../../packages/sdk-browser/src/visibility/projection.ts'
import { packedRowBase } from '../../../packages/sdk-browser/src/webgpu/row/pageRow.ts'
import { modelFloor } from '../../runner/trajectory/poses.ts'
import { measure, parElement, stress, rapport } from '../../core/index.ts'
import {
  referenceDevicePixels,
  referenceFloorOf,
  referenceNsToMs,
  referenceOutsidePlanes,
  referencePackedRowBase,
  referenceSignedArea,
} from '../../oracles/browser/ts-formulas.ts'
import { casPlans, durees, emprises, rangs, tailles, triangles } from './support/scenesFormulas.ts'
import type { MeasureCase } from '../../core/index.ts'

const single = <Entree>(name: string, input: Entree, size: number): MeasureCase<Entree>[] => [
  { name, input, size },
]
const options = { tours: 100, budgetMs: 500 }
type Triangle = (typeof triangles)[number]

const resPlanes = await measure({
  name: 'box outside the six planes',
  fichier: 'packages/sdk-core/src/math/frustum/box.ts',
  cas: single('400 plane sets × 400 hostile boxes', casPlans, casPlans.length),
  calculation: parElement((c: (typeof casPlans)[number]) =>
    frustumExcludesBox(c.planes, c.box[0], c.box[1], c.box[2], c.box[3], c.box[4], c.box[5]),
  ),
  expected: (list) =>
    list.map((c) =>
      referenceOutsidePlanes(c.planes, c.box[0], c.box[1], c.box[2], c.box[3], c.box[4], c.box[5]),
    ),
  options,
})

const resArea = await measure({
  name: 'signed screen-triangle area',
  fichier: 'packages/sdk-browser/src/visibility/projection.ts',
  cas: single('3 000 hostile triangles', triangles, triangles.length),
  calculation: parElement((t: Triangle) => signedArea(t.a, t.b, t.c)),
  expected: (list) => list.map((t) => referenceSignedArea(t.a, t.b, t.c)),
  options,
})

const resRow = await measure({
  name: 'row-identifier foundation',
  fichier: 'packages/sdk-browser/src/webgpu/row/pageRow.ts',
  cas: single('2 000 ranks', rangs, rangs.length),
  calculation: parElement((row: number) => packedRowBase(row)),
  expected: (list) => list.map((row) => referencePackedRowBase(row, VIS_TRIANGLE_BITS)),
  options,
})

const resPixels = await measure({
  name: 'device pixels from logical size',
  fichier: 'packages/sdk-browser/src/backend/common.ts',
  cas: single('2 000 sizes and ratios', tailles, tailles.length),
  calculation: parElement((t: (typeof tailles)[number]) => devicePixels(t.logical, t.ratio)),
  expected: (list) =>
    list.map((t) => referenceDevicePixels(t.logical, t.ratio, DEFAULT_PIXEL_RATIO)),
  options,
})

const resNs = await measure({
  name: 'nanoseconds to milliseconds',
  fichier: 'packages/sdk-browser/src/gpu/timing/types.ts',
  cas: single('2 000 durations', durees, durees.length),
  calculation: parElement((ns: number) => nanosecondsToMs(ns)),
  expected: (list) => list.map((ns) => referenceNsToMs(ns)),
  options,
})

const resFloor = await measure({
  name: 'model floor',
  fichier: 'bench/runner/trajectory/poses.ts',
  cas: single('1 000 extents', emprises, emprises.length),
  calculation: parElement((b: (typeof emprises)[number]) => modelFloor(b)),
  expected: (list) => list.map((b) => referenceFloorOf(b)),
  options,
})

await stress({
  name: 'devicePixels extremes',
  calculation: ([l, r]) => devicePixels(l, r),
  extremes: [
    { name: 'zero', input: [0, 1] },
    { name: 'ratio 0', input: [100, 0] },
  ],
})

rapport(
  'formules-ts',
  [resPlanes, resArea, resRow, resPixels, resNs, resFloor],
  'each shared formula yields exactly what the copies it replaces used to yield',
)
