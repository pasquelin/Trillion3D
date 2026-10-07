import type { WorldRootsCluster } from './worldRoots.ts'
import type { ClusterGroup } from '../contracts/geometry.ts'
import { encodeWorldRoots, type WorldRootsSpec } from './worldRootsRecords.fixture.ts'
import { readWorldRoots } from './worldRootsTable.ts'
import { encodeGeometryPage } from '../../../page-codec/src/geometryPage.ts'

/** One super-root page as the cook writes it, a geometry page: a triangle of three vertices, `x`
 *  its offset, with its facts (`WorldRootsPageFacts`). */
export function worldPage(x: number) {
  const array = Float32Array.of(x, 0, 0, x + 1, 0, 0, x, 1, 0)
  const { data, ...facts } = encodeGeometryPage([0, 1, 2], { POSITION: { itemSize: 3, array } })
  return { bytes: data as Uint8Array, facts: { bytes: data.byteLength, ...facts } }
}

/**
 * A world of three cells over four bundles of one page each: the top, bundle 0, pinned; bundles 1
 * and 2 the super-roots of cells 0 and 1; bundle 3, which cells 0 and 1 both need. Cell 2's
 * objects reach the top alone. `sha256` names each bundle's digest, `table.payload` the binary.
 * `spec` states it plainly, `bytes` are its records (`world-roots.table`) and `table` reads them.
 */
export function worldRootsFixture(sha256: (bytes: Uint8Array) => string = () => '0') {
  const pages = [0, 1, 2, 3].map((x) => worldPage(x).bytes)
  const bin = new Uint8Array(pages.reduce((sum, page) => sum + page.byteLength, 0))
  let offset = 0
  const bundles = pages.map((page, at) => {
    bin.set(page, offset)
    const bundle = {
      offset,
      bytes: page.byteLength,
      sha256: sha256(page),
      count: 1,
      dependencies: at ? [0] : [],
    }
    offset += page.byteLength
    return bundle
  })
  const object = (dependencies: number[]) => ({ node: 0, primitive: 0, roots: [0], dependencies })
  const spec: WorldRootsSpec = {
    version: 4,
    budgetBytes: 4 << 20,
    pinned: 1,
    pinnedTopBytes: bundles[0].bytes,
    payload: { url: 'world-roots.bin', sha256: sha256(bin), bytes: bin.byteLength },
    bundles,
    pages: bundles.map(({ bytes }, bundle) => ({
      bundle,
      offset: 0,
      bytes,
      level: 3 - bundle,
      lodError: 1,
    })),
    cells: [
      { objects: [object([0, 1, 3])] },
      { objects: [object([0, 2, 3]), object([0])] },
      { objects: [object([0])] },
    ],
  }
  const bytes = encodeWorldRoots(spec)
  return { spec, bytes, table: readWorldRoots(bytes), bin }
}

/** A world cluster (`WorldRootsCluster`) with the test-only `units`: the leaf unit span it
 *  covers, so a coverage check can run. */
type WorldRootsCookedCluster = WorldRootsCluster & { units: [number, number] }

/**
 * A world of three cells along x, each four object roots (level 0, kept in the objects' own
 * streams), continued into one cell super-root (level 1) and one world top (level 2): the shape
 * the cook publishes, its `clusters` and `groups` as it adds them (`world-roots.dag`). Cell
 * 2 far, its object roots unread, its super-root must stand in. `units` spans the leaf unit each
 * cluster covers, so a coverage check can read it.
 */
export function worldRootsDag() {
  const cells = 3,
    per = 4,
    leaves = cells * per,
    e1 = 0.05,
    e2 = 0.5
  const clusters: WorldRootsCookedCluster[] = []
  const groups: ClusterGroup[] = []
  for (let cell = 0; cell < cells; cell++)
    for (let i = 0; i < per; i++) {
      const u = cell * per + i
      clusters.push({
        cluster: u,
        level: 0,
        lodError: 0,
        sphere: [u + 0.5, 0, 0, 0.5],
        parentError: e1,
        parentSphere: [cell * per + 2, 0, 0, 2],
        min: [u, -0.25, -0.25],
        max: [u + 1, 0.25, 0.25],
        triangles: 2,
        primitive: 0,
        bundle: null,
        offset: null,
        origin: u,
        page: null,
        units: [u, u + 1],
      })
    }
  for (let cell = 0; cell < cells; cell++) {
    const cluster = clusters.length
    clusters.push({
      cluster,
      level: 1,
      lodError: e1,
      sphere: [cell * per + 2, 0, 0, 2],
      parentError: e2,
      parentSphere: [leaves / 2, 0, 0, leaves / 2],
      min: [cell * per, -0.25, -0.25],
      max: [(cell + 1) * per, 0.25, 0.25],
      triangles: 2 * per,
      primitive: 0,
      bundle: cell + 1,
      offset: 0,
      origin: null,
      page: worldPage(cell + 1).facts,
      units: [cell * per, (cell + 1) * per],
    })
    groups.push({
      level: 1,
      error: e1,
      sphere: [cell * per + 2, 0, 0, 2],
      children: [cell * per, cell * per + 1, cell * per + 2, cell * per + 3],
      outputs: [cluster],
    })
  }
  const top = clusters.length
  clusters.push({
    cluster: top,
    level: 2,
    lodError: e2,
    sphere: [leaves / 2, 0, 0, leaves / 2],
    parentError: null,
    parentSphere: null,
    min: [0, -0.25, -0.25],
    max: [leaves, 0.25, 0.25],
    triangles: 2 * leaves,
    primitive: 0,
    bundle: 0,
    offset: 0,
    origin: null,
    page: worldPage(0).facts,
    units: [0, leaves],
  })
  groups.push({
    level: 2,
    error: e2,
    sphere: [leaves / 2, 0, 0, leaves / 2],
    children: [leaves, leaves + 1, leaves + 2],
    outputs: [top],
  })
  return { clusters, groups, leaves }
}
