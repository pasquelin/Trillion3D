/**
 * The world roots' records as the cook writes them (`compiler_world_roots/records.rs`), for
 * a test that hands the reader a table or a DAG it states plainly: a header, fixed-size records,
 * then the `u32` pool their lists lie in.
 */
import type { ClusterGroup } from '../contracts/geometry.ts'
import type { WorldRoots, WorldRootsCluster, WorldRootsObject } from './worldRoots.ts'

/** A world-roots table stated plainly: its pages and cells as lists. */
export type WorldRootsSpec = Omit<WorldRoots, 'pages' | 'cells'> & {
  pages: { bundle: number; offset: number; bytes: number; level: number; lodError: number }[]
  cells: { objects: WorldRootsObject[] }[]
}

const NONE = 0xffffffff

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
  const objects = spec.cells.flatMap((cell) => cell.objects)
  r.raw(digest(spec.payload.sha256))
  for (const bundle of spec.bundles) {
    r.word(bundle.offset % 2 ** 32, Math.floor(bundle.offset / 2 ** 32), bundle.bytes, bundle.count)
    r.pooled(bundle.dependencies)
    r.raw(digest(bundle.sha256))
  }
  for (const page of spec.pages) {
    r.word(page.bundle, page.offset, page.level, page.bytes)
    r.float(page.lodError)
  }
  let first = 0
  for (const cell of spec.cells) {
    r.word(first, cell.objects.length)
    first += cell.objects.length
  }
  for (const object of objects) {
    r.word(object.node, object.primitive)
    r.pooled(object.roots)
    r.pooled(object.dependencies)
  }
  const { bytes } = spec.payload
  return r.end((poolWords) => [
    spec.version,
    spec.budgetBytes,
    spec.pinned,
    spec.pinnedTopBytes,
    spec.bundles.length,
    spec.pages.length,
    spec.cells.length,
    objects.length,
    poolWords,
    bytes % 2 ** 32,
    Math.floor(bytes / 2 ** 32),
  ])
}

/** `clusters` and `groups` as `world-roots.dag`, version `version`. */
export function encodeWorldRootsDag(
  { clusters, groups }: { clusters: readonly WorldRootsCluster[]; groups: readonly ClusterGroup[] },
  version = 4,
) {
  const r = writer('WRTD')
  const index = (value: number | null) => value ?? NONE
  for (const c of clusters) {
    r.word(c.level, c.triangles, index(c.primitive), index(c.bundle), index(c.offset))
    r.word(index(c.origin))
    r.float(c.lodError, c.parentError ?? NaN, ...c.sphere, ...(c.parentSphere ?? [NaN, 0, 0, 0]))
    r.float(...c.min, ...c.max)
    const p = c.page
    r.word(p?.bytes ?? 0, p?.vertexCount ?? 0, p?.indexCount ?? 0, p?.flags ?? 0)
    r.word(p?.uncompressedBytes ?? 0)
    r.raw(new Uint8Array(Float32Array.of(p?.quantizationError ?? 0).buffer))
  }
  for (const g of groups) {
    r.word(g.level)
    r.pooled(g.children)
    r.pooled(g.outputs)
    r.word(0)
    r.float(g.error, ...g.sphere)
  }
  return r.end((poolWords) => [version, clusters.length, groups.length, poolWords, 0])
}
