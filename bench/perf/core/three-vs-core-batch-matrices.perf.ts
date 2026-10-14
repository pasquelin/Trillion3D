// Three.js vs sdk-core, matrix batches: n matrices per call, flat buffers, zero allocation.
// Tested against Three's for loop on 200 000 elements, bit for bit.
import { composeMatrix4Batch } from '../../../packages/math/src/matrix/matrix4Compose.ts'
import { rapport } from '../../core/report.ts'
import type { Measurement } from '../../kit/measureTypes.ts'
import { duel, points, quaternion, N } from '../../oracles/core/three-duel.ts'
import { prepareBatchData } from '../../oracles/core/batch-duel.ts'

const BATCH = 'packages/math/src/batch/batch.ts'
const { outMats, outThreeMats, oracleMats } = prepareBatchData()
const lines: Measurement[] = []

// Matrix4.compose batch
const pos = points(N),
  scale = points(N, 0.2, 3),
  rotFlat = new Float64Array(N * 4)
const rot = Array.from({ length: N }, (_, i) => {
  const q = quaternion()
  rotFlat[i * 4] = q.x
  rotFlat[i * 4 + 1] = q.y
  rotFlat[i * 4 + 2] = q.z
  rotFlat[i * 4 + 3] = q.w
  return q
})
lines.push(
  await duel({
    name: 'Matrix4.compose batch',
    fichier: BATCH,
    three: () => {
      for (let i = 0; i < N; i++) outThreeMats[i].compose(pos.three[i], rot[i], scale.three[i])
    },
    oracle: oracleMats,
    core: () => {
      composeMatrix4Batch(outMats, pos.flat, rotFlat, scale.flat, N)
      return outMats
    },
  }),
)

rapport(
  'three-vs-core-batch-matrices',
  lines,
  'sdk-core matrix batches give the same bits as Three.js, at least as fast where they compute the same thing',
)
