// Absolute selection measurement: frustum clip and the pending pages of a cut. No oracle here:
// these two computations have no prior implementation to confront; their correctness is held by
// `bench/witnesses/three/parity/core/math/frustum/box.test.ts` and
// `packages/sdk-browser/src/page/selection/streamingBundles.test.ts`. Each line says so rather than
// staying silent.
import * as THREE from 'three'
import { clipPlanesFromMatrix, frustumClipBox } from '../../../packages/sdk-core/src/index.ts'
import { collectPendingUrls } from '../../../packages/sdk-browser/src/page/selection/requests.ts'
import { measure, rapport, stress } from '../../core/index.ts'
import { boxes, camera, type SceneBox } from './support/scenes.ts'
import { pageRecFixture } from './support/pageRecFixture.ts'
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts'

const cam = camera(6, 0.1, 16 / 9)
const clip = new THREE.Matrix4().multiplyMatrices(
  new THREE.Matrix4().fromArray(cam.projectionMatrix.elements),
  new THREE.Matrix4().fromArray(cam.matrixWorldInverse.elements),
)
const planes = new Float64Array(24)
clipPlanesFromMatrix(planes, clip.elements)

const flatBoxes = (list: SceneBox[]) => {
  const plat = new Float64Array(list.length * 6)
  for (let i = 0; i < list.length; i++) {
    plat.set(list[i].min, i * 6)
    plat.set(list[i].max, i * 6 + 3)
  }
  return plat
}
const grande = flatBoxes(boxes({ count: 20000 })),
  empty = new Float64Array(0)

const clipper = (plat: Float64Array) => {
  const verdicts = new Uint8Array(plat.length / 6)
  for (let i = 0; i < verdicts.length; i++) {
    const b = i * 6
    verdicts[i] = frustumClipBox(
      planes,
      plat[b],
      plat[b + 1],
      plat[b + 2],
      plat[b + 3],
      plat[b + 4],
      plat[b + 5],
    )
  }
  return verdicts
}

// ── Measure frustumClipBox ────────────────────────────────────────────
const clipResult = await measure({
  name: 'frustumClipBox',
  fichier: 'packages/math/src/geometry/frustum/box.ts',
  cas: [
    { name: '20k boxes including degenerates', input: grande, size: 20000 },
    { name: 'no boxes', input: empty, size: 0 },
  ],
  calculation: clipper,
  motif: 'time only — correctness in bench/witnesses/three/parity/core/math/frustum/box.test.ts',
  options: { tours: 200, budgetMs: 1000 },
})

// ── Pending pages measurement ────────────────────────────────────────
const hostPage = (
  url: string,
  streamUrl: string | undefined,
  array: Uint32Array | undefined,
): PageRec => pageRecFixture({ url, streamUrl, array })

function host(count: number) {
  const pages: PageRec[] = []
  for (let i = 0; i < count; i++)
    pages.push(
      hostPage(
        `page-${i % Math.max(1, Math.floor(count * 0.6))}.bin`,
        i % 5 ? undefined : `bundle-${i % 400}.bin`,
        i % 3 ? undefined : new Uint32Array(3),
      ),
    )
  return { pages, vers: [] as string[] }
}
const largeHost = host(15000),
  emptyHost = host(0)

const residenceResult = await measure({
  name: 'collectPendingUrls',
  fichier: 'packages/sdk-browser/src/page/selection/requests.ts',
  cas: [
    { name: '15k pages', input: largeHost, size: 15000 },
    { name: 'no pages', input: emptyHost, size: 0 },
  ],
  calculation: (h) => collectPendingUrls(h.pages, h.vers).slice(),
  motif:
    'time only — correctness in packages/sdk-browser/src/page/selection/streamingBundles.test.ts',
  options: { tours: 60, budgetMs: 1000 },
})

// ── Stress testing ───────────────────────────────────────────────────
await stress({
  name: 'frustumClipBox extremes',
  calculation: (e) => frustumClipBox(planes, e[0], e[1], e[2], e[3], e[4], e[5]),
  extremes: [
    { name: 'NaN box', input: [NaN, NaN, NaN, NaN, NaN, NaN] },
    {
      name: 'Infinity box',
      input: [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity],
    },
    { name: 'inverted box', input: [1, 1, 1, -1, -1, -1] },
    { name: 'zero box', input: [0, 0, 0, 0, 0, 0] },
    { name: '-0 box', input: [-0, -0, -0, -0, -0, -0] },
  ],
})

rapport(
  'tronc-residence',
  [clipResult, residenceResult],
  'Selection: frustum clip and residency — absolute measurement',
)
