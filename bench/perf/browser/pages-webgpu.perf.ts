// winding of a cluster.
import { Matrix4 } from '../../../packages/sdk-core/src/world/math/matrix4.ts'
import { Vector3 } from '../../../packages/sdk-core/src/world/math/vector3.ts'
import { Quaternion } from '../../../packages/sdk-core/src/world/math/quaternion.ts'
import { Euler } from '../../../packages/sdk-core/src/world/math/euler.ts'
import {
  setWindingEpoch,
  windingCw,
} from '../../../packages/sdk-browser/src/webgpu/pages/render/winding.ts'
import { measure } from '../../core/measure.ts'
import { stress } from '../../core/measureStress.ts'
import { rapport } from '../../core/report.ts'
import { xorshiftRandom } from '../../../packages/math/src/sequence/random.ts'
import { referenceWindingCw } from '../../oracles/browser/pages-webgpu.ts'
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts'
import { pageRecFixture } from './support/pageRecFixture.ts'

const alea = xorshiftRandom(67)

/** A record with the world the oracle reads on it, and the one root that carries it. */
type Cluster = PageRec & { matrix: Matrix4; roots: { world: Matrix4 }[] }
const pageOf = (matrix: Matrix4): Cluster => ({
  ...pageRecFixture(),
  matrix,
  roots: [{ world: matrix }],
})

function clusters(count: number): Cluster[] {
  const recs: Cluster[] = []
  for (let i = 0; i < count; i++) {
    const matrix = new Matrix4().compose(
      new Vector3((alea() - 0.5) * 40, (alea() - 0.5) * 20, -alea() * 60),
      new Quaternion().setFromEuler(new Euler(alea() * 6.28, alea() * 6.28, alea() * 6.28)),
      new Vector3(1, 1, i % 7 ? 1 : -1),
    )
    recs.push(pageOf(matrix))
  }
  return recs
}
const gros = clusters(20000),
  seul = clusters(1)

const LECTURES = 4
let epoque = 0
const imageDeSens = (sens: (rec: Cluster) => boolean, pose: boolean) => (recs: Cluster[]) => {
  epoque++
  if (pose) setWindingEpoch(epoque)
  const verdicts = new Uint8Array(recs.length * LECTURES)
  for (let lecture = 0; lecture < LECTURES; lecture++)
    for (let i = 0; i < recs.length; i++)
      verdicts[lecture * recs.length + i] = sens(recs[i]) ? 1 : 0
  return verdicts
}

const resWinding = await measure({
  name: 'windingCw',
  fichier: 'packages/sdk-browser/src/webgpu/pages/render/winding.ts',
  cas: [
    { name: '20 000 clusters, 4 reads', input: gros, size: gros.length },
    { name: 'one cluster', input: seul, size: 1 },
    { name: 'no clusters', input: [], size: 0 },
  ],
  calculation: imageDeSens((c) => windingCw(c.roots, 0), true),
  expected: imageDeSens(referenceWindingCw, false),
  options: { tours: 100, budgetMs: 1500 },
})

await stress({
  name: 'windingCw extremes',
  calculation: (c: Cluster) => windingCw(c.roots, 0),
  extremes: [
    {
      name: 'zero matrix',
      input: pageOf(new Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    },
    { name: 'negative scale', input: pageOf(new Matrix4().makeScale(-1, -1, -1)) },
  ],
})

rapport('pages-webgpu', [resWinding], 'A9 yields the exact same values')
