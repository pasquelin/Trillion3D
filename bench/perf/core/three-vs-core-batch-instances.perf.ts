// Per-instance batches: identical seeded inputs; flattening belongs to the untimed oracle.
import * as THREE from 'three'
import { boxEmpty } from '../../../packages/math/src/geometry/box.ts'
import { boxUnionBatch } from '../../../packages/math/src/batch/batch.ts'
import { transformPointsByMatricesBatch } from '../../../packages/math/src/batch/points.ts'
import {
  createBoxTransformLot,
  madeLot,
} from '../../../packages/sdk-browser/src/page/decode/batch/batchRuntime.ts'
import { rapport } from '../../core/report.ts'
import type { Measurement } from '../../kit/measureTypes.ts'
import { duel, N } from '../../oracles/core/three-duel.ts'
import { prepareBatchData } from '../../oracles/core/batch-duel.ts'
// Node cannot fetch the WebAssembly module by its URL: the fixture hands it the shipped bytes.
import '../../../packages/sdk-browser/src/wasm/sdkWasm.fixture.ts'

const { mats, pts, outPts, outThreePts, oraclePts, boxes, threeBoxes } = prepareBatchData()
const lines: Measurement[] = []
lines.push(
  await duel({
    name: 'Vector3.applyMatrix4 per-instance batch',
    fichier: 'packages/math/src/batch/points.ts',
    three: () => {
      for (let i = 0; i < N; i++) outThreePts[i].copy(pts.three[i]).applyMatrix4(mats.three[i])
    },
    oracle: oraclePts,
    core: () => {
      transformPointsByMatricesBatch(outPts, mats.views, pts.flat, N)
      return outPts
    },
  }),
)

const threeUnion = new THREE.Box3(),
  scratch = new THREE.Box3()
// The engine's one batch of moved boxes: the WebAssembly lot, its output united.
const lot = madeLot(await createBoxTransformLot(N), N)
const oracleUnion = new Float64Array(6),
  union = new Float64Array(6)
lines.push(
  await duel({
    name: 'Box3 transform and union batch',
    fichier: 'packages/sdk-browser/src/page/decode/batch/batchRuntime.ts',
    three: () => {
      threeUnion.makeEmpty()
      for (let i = 0; i < N; i++)
        threeUnion.union(scratch.copy(threeBoxes[i]).applyMatrix4(mats.three[i]))
    },
    oracle: () => {
      threeUnion.min.toArray(oracleUnion, 0)
      threeUnion.max.toArray(oracleUnion, 3)
      return oracleUnion
    },
    core: () => {
      lot.boxes.set(boxes)
      lot.mats.set(mats.flat)
      lot.run(N)
      boxEmpty(union, 0)
      boxUnionBatch(union, lot.out, N)
      return union
    },
  }),
)
rapport(
  'three-vs-core-batch-instances',
  lines,
  'Per-instance batches: seeded parity and timed operations',
)
