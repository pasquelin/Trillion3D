/**
 * The world HLOD's records as the cook writes them (`chain/records.rs`), for a test
 * that hands the reader a table or a DAG it states plainly: a header, fixed-size records, then the
 * `u32` pool their lists lie in.
 */
import { uint64Words } from '../../../math/src/scalar/uint64.fixture.ts'
import type { ClusterGroup, CullingHierarchy } from '../contracts/geometry.ts'
import { CHAIN_ACTOR, type WorldRoots, type WorldRootsCluster } from './worldRoots.ts'
import { WORLD_ROOTS_VERSION } from '../contracts/writtenFormats.ts'

/** A world-roots table stated plainly: its pages as a list. */
export type WorldRootsSpec = Omit<WorldRoots, 'pages'> & {
  pages: { bundle: number; offset: number; bytes: number; level: number; lodError: number }[]
}

/** The rows of `cells` HLOD cells whose actors place none (`WorldRoots.rows`). */
export const noRows = (cells: number): WorldRoots['rows'] => ({
  bundle: new Int32Array(cells).fill(-1),
  count: new Uint32Array(cells),
})

/** A records file being written: little-endian words, `f64`s, raw bytes, and the pool. */
function writer(magic: string) {
  const pool: number[] = []
  const parts: Uint8Array[] = [Uint8Array.from(magic, (c) => c.charCodeAt(0))]
  const bytesOf = (values: number[], float: boolean) => {
    const out = new DataView(new ArrayBuffer(values.length * (float ? 8 : 4)))
    values.forEach((v, i) =>
      float ? out.setFloat64(i * 8, v, true) : out.setUint32(i * 4, v, true),
    )
    return new Uint8Array(out.buffer)
  }
  const r = {
    word: (...values: number[]) => void parts.push(bytesOf(values, false)),
    float: (...values: number[]) => void parts.push(bytesOf(values, true)),
    raw: (bytes: Uint8Array) => void parts.push(bytes),
    /** `list` in the pool, its first word and its length in the record. */
    pooled(list: readonly number[]) {
      r.word(pool.length, list.length)
      pool.push(...list)
    },
    end(header: (poolWords: number) => number[]) {
      parts.splice(1, 0, bytesOf(header(pool.length), false))
      const all = [...parts, bytesOf(pool, false)]
      const out = new Uint8Array(all.reduce((sum, p) => sum + p.byteLength, 0))
      all.reduce((at, p) => (out.set(p, at), at + p.byteLength), 0)
      return out
    },
  }
  return r
}

const digest = (hex: string) =>
  Uint8Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2) || '0', 16) || 0)

/** `spec` as `world-roots.table`. */
export function encodeWorldRoots(spec: WorldRootsSpec) {
  const r = writer('WRTB')
  r.raw(digest(spec.payload.sha256))
  for (const bundle of spec.bundles) {
    r.word(...uint64Words(bundle.offset), bundle.bytes, bundle.count)
    r.pooled(bundle.dependencies)
    r.raw(digest(bundle.sha256))
  }
  for (const page of spec.pages) {
    r.word(page.bundle, page.offset, page.level, page.bytes)
    r.float(page.lodError)
  }
  spec.hlod.forEach((held, cell) => {
    r.pooled(held)
    const parent = spec.chain.parent[cell]
    const warmup = spec.chain.actor[cell] & CHAIN_ACTOR.warmup ? 1 : 0
    r.word(
      parent < 0 ? 0xffffffff : parent,
      spec.chain.level[cell] |
        (warmup << 8) |
        (spec.chain.rung[cell] << 9) |
        (spec.chain.grid[cell] << 16),
      spec.chain.actorLevel[cell],
    )
    // Its actor's rows: the bundle holding them, none's `u32::MAX`, and their count.
    const own = spec.rows.bundle[cell]
    r.word(own < 0 ? 0xffffffff : own, spec.rows.count[cell])
    r.float(...spec.chain.bounds.subarray(6 * cell, 6 * cell + 6))
    r.float(...spec.chain.content.subarray(6 * cell, 6 * cell + 6))
  })
  const { bytes } = spec.payload
  return r.end((poolWords) => [
    spec.version,
    spec.bundles.length,
    spec.pages.length,
    spec.hlod.length,
    poolWords,
    ...uint64Words(bytes),
  ])
}

/** `clusters`, `groups` and their `culling` hierarchy (none written without) as
 *  `world-roots.dag`, version `version`. */
export function encodeWorldRootsDag(
  {
    clusters,
    groups,
    culling,
  }: {
    clusters: readonly WorldRootsCluster[]
    groups: readonly ClusterGroup[]
    culling?: CullingHierarchy
  },
  version = WORLD_ROOTS_VERSION,
) {
  const r = writer('WRTD')
  for (const c of clusters) {
    r.word(c.level, c.triangles, c.material, c.bundle, c.offset, c.hlod, 0, 0)
    r.float(c.lodError, c.parentError ?? NaN, ...c.sphere, ...(c.parentSphere ?? [NaN, 0, 0, 0]))
    r.float(...c.min, ...c.max)
    const p = c.page
    r.word(
      ...[p.bytes, p.vertexCount, p.indexCount, p.flags, p.uncompressedBytes],
      ...[p.residentBytes, p.residentOffset],
    )
  }
  for (const g of groups) {
    r.word(g.level)
    r.pooled(g.children)
    r.pooled(g.outputs)
    r.word(0)
    r.float(g.error, ...g.sphere)
  }
  if (culling) r.float(...culling.nodes)
  return r.end((poolWords) => [
    version,
    clusters.length,
    groups.length,
    poolWords,
    culling?.count ?? 0,
  ])
}
