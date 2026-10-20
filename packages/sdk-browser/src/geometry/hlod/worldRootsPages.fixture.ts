import {
  CHAIN_ACTOR,
  type WorldRoots,
  type WorldRootsCluster,
} from '../../../../sdk-core/src/manifest/worldRoots.ts'
import type { ClusterGroup } from '../../../../sdk-core/src/contracts/geometry.ts'
import {
  encodeWorldRoots,
  type WorldRootsSpec,
} from '../../../../sdk-core/src/manifest/worldRootsRecords.fixture.ts'
import { readWorldRoots } from '../../../../sdk-core/src/manifest/worldRootsTable.ts'
import { WORLD_ROOTS_VERSION } from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import { encodePage } from '../codec/encodePage.fixture.ts'
import { inCullingOrder } from './worldCulling.fixture.ts'

/** One world page as the cook writes it, a geometry page: a triangle of three vertices, `x`
 *  its offset, with its facts (`WorldRootsPageFacts`). */
export function worldPage(x: number) {
  const array = Float32Array.of(x, 0, 0, x + 1, 0, 0, x, 1, 0)
  // The world DAG records no cone of its pages: the page carries it (`WorldRootsPageFacts`).
  const { data, cone: _, ...facts } = encodePage([0, 1, 2], { POSITION: { itemSize: 3, array } })
  return { bytes: data as Uint8Array, facts: { bytes: data.byteLength, ...facts } }
}

/** `bundles`, each a list of pages, laid end to end in one binary, bundle after bundle, each
 *  needing `dependencies(at)`: the binary and its bundles, each digest named by `sha256`. */
export function packBundles(
  bundles: readonly (readonly Uint8Array[])[],
  sha256: (bytes: Uint8Array) => string,
  dependencies: (at: number) => number[] = () => [],
) {
  const all = bundles.flat()
  const bin = new Uint8Array(all.reduce((sum, page) => sum + page.byteLength, 0))
  let offset = 0
  const records = bundles.map((pages, at) => {
    const from = offset
    for (const page of pages) bin.set(page, (offset += page.byteLength) - page.byteLength)
    const bytes = bin.subarray(from, offset)
    return {
      offset: from,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      count: pages.length,
      dependencies: dependencies(at),
    }
  })
  return { bin, bundles: records }
}

/** The world's HLOD 0 cells. */
const CELLS = 3

/** A chain of `count` HLOD 0 cells along x, one unit each, every one a top cell whose actor is
 *  built: always loaded (`WorldRoots.chain`). */
export function flatChain(count: number): WorldRoots['chain'] {
  return {
    parent: new Int32Array(count).fill(-1),
    level: new Uint8Array(count),
    actor: new Uint8Array(count).fill(CHAIN_ACTOR.built),
    bounds: Float64Array.from({ length: 6 * count }, (_, at) => {
      const [cell, k] = [Math.floor(at / 6), at % 6]
      return k === 0 ? cell : k === 3 ? cell + 1 : k < 3 ? -1 : 1
    }),
  }
}
/** The bundle holding HLOD 0 cell `cell`'s HLOD 1 root: cell 2's lies first in the binary. */
const rootBundle = (cell: number) => (cell + 1) % CELLS
/** The bundle holding every cell's level 0 pages, last in the binary. */
const CHILDREN = CELLS

/**
 * The world HLOD of three HLOD 0 cells over four bundles: bundles 1, 2 and 0 hold the HLOD 1 roots
 * of cells 0, 1 and 2, one page each; bundle 3 the three cells' level 0 pages, needing every root.
 * Cells 0 and 1 hold bundle 3 besides their root's, cell 2 its root's alone. `sha256` names each
 * bundle's digest, `table.payload` the binary. `spec` states it plainly, `bytes` are its records
 * (`world-roots.table`) and `table` reads them.
 */
export function worldRootsFixture(sha256: (bytes: Uint8Array) => string = () => '0') {
  const pages = [[0], [1], [2], [3, 4, 5]].map((xs) => xs.map((x) => worldPage(x).bytes))
  const { bin, bundles } = packBundles(pages, sha256, (at) => (at === CHILDREN ? [0, 1, 2] : []))
  const spec: WorldRootsSpec = {
    version: WORLD_ROOTS_VERSION,
    payload: { url: 'world-roots.bin', sha256: sha256(bin), bytes: bin.byteLength },
    bundles,
    pages: pages.flatMap((list, bundle) =>
      list.map((page, k) => ({
        bundle,
        offset: k * page.byteLength,
        bytes: page.byteLength,
        level: bundle === CHILDREN ? 0 : 1,
        lodError: bundle === CHILDREN ? 0 : 1,
      })),
    ),
    hlod: [[1, 3], [2, 3], [0]],
    chain: flatChain(CELLS),
  }
  const bytes = encodeWorldRoots(spec)
  return { spec, bytes, table: readWorldRoots(bytes), bin }
}

/** A world cluster (`WorldRootsCluster`) with the test-only `units`: the leaf unit span it
 *  covers, so a coverage check can run. */
type WorldRootsCookedCluster = WorldRootsCluster & { units: [number, number] }

/**
 * The world HLOD of three HLOD 0 cells along x, one unit each, as the cook publishes it
 * (`world-roots.dag`): per cell, its HLOD 1 merged from the cell's level 0 geometry
 * (`compiler_world_roots/world.rs`) — a level 0 cluster at error 0, its page in bundle 3, and the
 * root replacing it at level 1, its page alone in its cell's bundle (`worldRootsFixture`) —, every
 * error the build's own. `units` spans the leaf unit each cluster covers, so a coverage check can
 * read it.
 */
export function worldRootsDag() {
  const leaves = CELLS,
    e1 = 0.05
  const clusters: WorldRootsCookedCluster[] = []
  const groups: ClusterGroup[] = []
  const box = (u: number) => ({ min: [u, -0.25, -0.25], max: [u + 1, 0.25, 0.25] })
  const sphere = (u: number) => [u + 0.5, 0, 0, 0.5]
  const layer = { material: 0, triangles: 1 }
  for (let u = 0; u < leaves; u++)
    clusters.push({
      cluster: u,
      level: 0,
      lodError: 0,
      sphere: sphere(u),
      parentError: e1,
      parentSphere: sphere(u),
      ...box(u),
      ...layer,
      bundle: CHILDREN,
      offset: u * worldPage(0).facts.bytes,
      hlod: u,
      page: worldPage(CELLS + u).facts,
      units: [u, u + 1],
    })
  for (let u = 0; u < leaves; u++) {
    const cluster = clusters.length
    clusters.push({
      cluster,
      level: 1,
      lodError: e1,
      sphere: sphere(u),
      parentError: null,
      parentSphere: null,
      ...box(u),
      ...layer,
      bundle: rootBundle(u),
      offset: 0,
      hlod: u,
      page: worldPage(rootBundle(u)).facts,
      units: [u, u + 1],
    })
    groups.push({ level: 1, error: e1, sphere: sphere(u), children: [u], outputs: [cluster] })
  }
  return { ...inCullingOrder({ clusters, groups }), leaves }
}

/** The fixture's binary as the world DAG names its pages: `world-roots.bin`, each bundle at its
 *  offset, over its HLOD 0 cells. */
export const worldBinary = () => ({
  url: 'world-roots.bin',
  chain: flatChain(CELLS),
  bundles: worldRootsFixture().table.bundles,
})
