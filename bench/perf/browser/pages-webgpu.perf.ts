// winding of a cluster.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { surfaceOf } from '../../../packages/sdk-browser/src/page/surface.ts'
import {
  setWindingEpoch,
  windingCw,
} from '../../../packages/sdk-browser/src/webgpu/pages/render/winding.ts'
import { xorshiftRandom, measure, stress, rapport } from '../../core/index.ts'
import { referenceWindingCw } from '../../oracles/browser/pages-webgpu.ts'
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts'

const alea = xorshiftRandom(67)

/** Fields the winding test never reads: shared across every fixture record. */
const DUMMY_ATTRIBUTES: G.Geometry['attributes'] = {}
const DUMMY_BOUNDS: number[] = [0, 0, 0]
/** A record with the world the oracle reads on it, and the one root that carries it. */
type Cluster = PageRec & { matrix: G.Matrix4; roots: { world: G.Matrix4 }[] }
const pageOf = (matrix: G.Matrix4): Cluster => ({
  id: 0,
  url: '',
  clusterId: '',
  triangles: 0,
  indexBytes: 0,
  min: DUMMY_BOUNDS,
  max: DUMMY_BOUNDS,
  depthLayer: 0,
  attributes: DUMMY_ATTRIBUTES,
  material: surfaceOf([]),
  matrix,
  roots: [{ world: matrix }],
  renderOrder: 0,
})

function clusters(count: number): Cluster[] {
  const recs: Cluster[] = []
  for (let i = 0; i < count; i++) {
    const matrix = new G.Matrix4().compose(
      new G.Vector3((alea() - 0.5) * 40, (alea() - 0.5) * 20, -alea() * 60),
      new G.Quaternion().setFromEuler(new G.Euler(alea() * 6.28, alea() * 6.28, alea() * 6.28)),
      new G.Vector3(1, 1, i % 7 ? 1 : -1),
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
      input: pageOf(new G.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    },
    { name: 'negative scale', input: pageOf(new G.Matrix4().makeScale(-1, -1, -1)) },
  ],
})

rapport('pages-webgpu', [resWinding], 'A9 yields the exact same values')
