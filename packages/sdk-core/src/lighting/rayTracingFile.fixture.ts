// The ray tracing files the tests build, in the flat format: one record of one node and two triangles, and the same
// with a second record; and any of them with its corners shared among vertices, as the compiler writes it.
import {
  RAY_TRACING_FLAG_TWO_SIDED,
  RAY_TRACING_FLAT_VERSION,
  RAY_TRACING_HEAD_BYTES,
  RAY_TRACING_INDEXED_TRIANGLE_BYTES,
  RAY_TRACING_LEAF_COUNT_SHIFT,
  RAY_TRACING_MAGIC,
  RAY_TRACING_NODE_BYTES,
  RAY_TRACING_RECORD_AT,
  RAY_TRACING_RECORD_BYTES,
  RAY_TRACING_TRIANGLE_BYTES,
  RAY_TRACING_VERSION,
  RAY_TRACING_VERTEX_BYTES,
} from '../contracts/rayTracingAbi.ts'

/** A flat file of the one record of primitive `primitive` of mesh `mesh`, one node (a leaf child of
 *  `triangles` triangles at its slot 0) and two triangles, `mutate` altering the bytes. */
export function fileOf(
  options: { mesh?: number; primitive?: number; triangles?: number } = {},
  mutate: (view: DataView) => void = () => {},
) {
  const { mesh = 5, primitive = 3, triangles = 2 } = options
  const nodesAt = RAY_TRACING_HEAD_BYTES + RAY_TRACING_RECORD_BYTES
  const trianglesAt = nodesAt + RAY_TRACING_NODE_BYTES
  const bytes = new Uint8Array(trianglesAt + 2 * RAY_TRACING_TRIANGLE_BYTES)
  const view = new DataView(bytes.buffer)
  ;[RAY_TRACING_MAGIC, RAY_TRACING_FLAT_VERSION, 1, 1, 2].forEach((word, k) =>
    view.setUint32(k * 4, word, true),
  )
  const record = RAY_TRACING_HEAD_BYTES
  const R = RAY_TRACING_RECORD_AT
  view.setUint32(record + R.mesh * 4, mesh, true)
  view.setUint32(record + R.primitive * 4, primitive, true)
  view.setUint32(record + R.flags * 4, RAY_TRACING_FLAG_TWO_SIDED, true)
  view.setFloat32(record + R.error * 4, 0.25, true)
  view.setUint32(record + R.nodeCount * 4, 1, true)
  view.setUint32(record + R.triangleCount * 4, 2, true)
  ;[-1, -2, -3, 1, 2, 3].forEach((v, k) => view.setFloat32(record + (R.boxMin + k) * 4, v, true))
  // The node: its corner, an exponent of 0 a side and no child that is a node, then the metas:
  // slot 0 a leaf of `triangles` triangles at offset 0, the others empty.
  // The corner is the node's words 0 to 2 and the metas start at its word 6.
  ;[-1, -2, -3].forEach((v, k) => view.setFloat32(nodesAt + k * 4, v, true))
  view.setUint8(nodesAt + 6 * 4, triangles << RAY_TRACING_LEAF_COUNT_SHIFT)
  // The triangles: the corners, then the cluster and the rank in it.
  for (let t = 0; t < 2; t++) {
    const at = trianglesAt + t * RAY_TRACING_TRIANGLE_BYTES
    ;[0, 0, 0, 1, 0, 0, 0, 1, t].forEach((v, k) => view.setFloat32(at + k * 4, v, true))
    view.setUint32(at + 36, 7 + t, true)
    view.setUint32(at + 40, t, true)
  }
  mutate(view)
  return bytes
}

/** `fileOf()` with a second record after the first, which holds the first's node and a triangle, the second the
 *  other triangle and no node; `second` sets the second record's words and `first` the first's. */
export function twoRecords(
  second: (view: DataView, at: number) => void,
  first: (view: DataView, at: number) => void = () => {},
) {
  const one = fileOf()
  const bytes = new Uint8Array(one.length + RAY_TRACING_RECORD_BYTES)
  const record = RAY_TRACING_HEAD_BYTES
  const nodesAt = record + RAY_TRACING_RECORD_BYTES
  // The head, the first record, a second one, then the rest.
  bytes.set(one.subarray(0, nodesAt))
  bytes.set(one.subarray(nodesAt), nodesAt + RAY_TRACING_RECORD_BYTES)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 2, true)
  bytes.set(one.subarray(record, nodesAt), nodesAt)
  const R = RAY_TRACING_RECORD_AT
  view.setUint32(record + R.triangleCount * 4, 1, true)
  view.setUint32(nodesAt + R.firstNode * 4, 1, true)
  view.setUint32(nodesAt + R.nodeCount * 4, 0, true)
  view.setUint32(nodesAt + R.firstTriangle * 4, 1, true)
  view.setUint32(nodesAt + R.triangleCount * 4, 1, true)
  first(view, record)
  second(view, nodesAt)
  return bytes
}

/** The flat file `flat` as the compiler writes it: its head, records and nodes, then each corner of its triangles
 *  once, in the order they first come, then each triangle as its corners — zero for the next vertex, else how far
 *  back it lies from the next — and its last three words (`encode.rs`). */
export function indexedOf(flat: Uint8Array) {
  const head = new DataView(flat.buffer, flat.byteOffset, flat.byteLength)
  const [records, nodes, triangles] = [8, 12, 16].map((at) => head.getUint32(at, true))
  const nodesEnd =
    RAY_TRACING_HEAD_BYTES + records * RAY_TRACING_RECORD_BYTES + nodes * RAY_TRACING_NODE_BYTES
  // A flat triangle's corners, and an indexed one's three corner words.
  const [cornerBytes, rankBytes] = [3 * RAY_TRACING_VERTEX_BYTES, 3 * 4]
  const rank = new Map<string, number>()
  const vertices: Uint8Array[] = []
  const indexed = new Uint8Array(triangles * RAY_TRACING_INDEXED_TRIANGLE_BYTES)
  const out = new DataView(indexed.buffer)
  for (let t = 0; t < triangles; t++) {
    const [from, to] = [
      nodesEnd + t * RAY_TRACING_TRIANGLE_BYTES,
      t * RAY_TRACING_INDEXED_TRIANGLE_BYTES,
    ]
    for (let c = 0; c < 3; c++) {
      const corner = flat.subarray(
        from + c * RAY_TRACING_VERTEX_BYTES,
        from + (c + 1) * RAY_TRACING_VERTEX_BYTES,
      )
      const [key, next] = [corner.join(), vertices.length]
      const seen = rank.get(key)
      if (seen === undefined) {
        rank.set(key, next)
        vertices.push(corner)
      }
      out.setUint32(to + c * 4, seen === undefined ? 0 : next - seen, true)
    }
    indexed.set(
      flat.subarray(from + cornerBytes, from + RAY_TRACING_TRIANGLE_BYTES),
      to + rankBytes,
    )
  }
  const bytes = new Uint8Array(
    nodesEnd + vertices.length * RAY_TRACING_VERTEX_BYTES + indexed.length,
  )
  bytes.set(flat.subarray(0, nodesEnd))
  vertices.forEach((corner, v) => bytes.set(corner, nodesEnd + v * RAY_TRACING_VERTEX_BYTES))
  bytes.set(indexed, bytes.length - indexed.length)
  const written = new DataView(bytes.buffer)
  written.setUint32(4, RAY_TRACING_VERSION, true)
  written.setUint32(20, vertices.length, true)
  return bytes
}
