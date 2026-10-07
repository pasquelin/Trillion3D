/**
 * The host attributes of the prepared scene's accessors, viewed on the binary the scene tables
 * lay out — read on first need, not at session start —, under the host loader's rules: an attribute is viewed inside a copy of its view; an
 * interleaved view is one host buffer per slice of vertices; a sparse accessor is a copy of its
 * base with the substituted elements written in; a run shared by two primitives is one attribute.
 */
import { EngineError } from '../../../../sdk-core/src/index.ts'
import type {
  TableAccessor,
  TableDocument,
} from '../../../../sdk-core/src/scene/core/tableDocuments.ts'
import {
  BufferAttribute,
  InterleavedBufferAttribute,
  InterleavedBuffer,
  ownAttribute,
  pendingAttribute,
  pendingInterleaved,
  type BufferTypedArray,
  type VertexAttribute,
} from '../../../../sdk-core/src/world/buffer/attribute.ts'
import { normalisedUnit } from '../../../../sdk-core/src/world/buffer/elements.ts'
import { readOnce } from '../../../../sdk-core/src/world/buffer/pending.ts'

/** Storage of each glTF component type. */
const COMPONENTS = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
} as const
/** Components per element of each glTF element type. */
const WIDTHS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 } as const
/** What one unit of a normalised element of `componentType` is worth: the scale a declared box is read at. */
export const normalisedScale = (componentType: number) =>
  normalisedUnit(COMPONENTS[componentType as keyof typeof COMPONENTS])

type Attribute = VertexAttribute
type Storage = (typeof COMPONENTS)[keyof typeof COMPONENTS]

/** Numbers of `Storage` read from the binary on first need: `length` of them. */
const later = (Storage: Storage, length: number, read: () => Promise<BufferTypedArray>) => ({
  length,
  type: Storage.name,
  read,
})

/** Writes the substituted elements of a sparse accessor into a copy of its base's own elements
 *  (never the whole interleaved buffer it may view), as the loader does. */
async function substitute(
  base: Attribute,
  accessor: TableAccessor,
  viewOf: (rank: number) => Promise<ArrayBuffer>,
) {
  const sparse = accessor.sparse!
  const width = base.itemSize
  const Ranks = COMPONENTS[sparse.indices.componentType]
  const Values = COMPONENTS[accessor.componentType]
  const [rankView, valueView] = await Promise.all([
    viewOf(sparse.indices.view),
    viewOf(sparse.values.view),
    base._load(),
  ])
  const ranks = new Ranks(rankView, sparse.indices.offset, sparse.count)
  const values = new Values(valueView, sparse.values.offset, sparse.count * width)
  const out = accessor.view === null ? (base as BufferAttribute) : ownAttribute(base)
  out.normalized = false
  for (let i = 0; i < ranks.length; i++) {
    out.setX(ranks[i], values[i * width])
    if (width >= 2) out.setY(ranks[i], values[i * width + 1])
    if (width >= 3) out.setZ(ranks[i], values[i * width + 2])
    if (width >= 4) out.setW(ranks[i], values[i * width + 3])
  }
  return out.array
}

/** Where the vertices of a prepared document are read: the whole binary, read once and kept, or
 *  `range`, which reads the bytes of one view alone. */
export type PreparedBinary =
  (() => Promise<ArrayBuffer>) | { range: (offset: number, length: number) => Promise<ArrayBuffer> }

/** The host attribute of each accessor of `document`, built on first request and shared after it.
 *  Its numbers are read from the document's buffer only when a reader loads them
 *  (`Geometry.loadVertices`): `binary` reads the buffer, once, on that first need, or each view
 *  alone by its `range`. */
export function preparedAccessors(document: TableDocument, binary: PreparedBinary) {
  const attributes = new Map<number, Attribute>()
  const viewOf = viewReader(document, binary)
  const build = attributeBuilder(document, viewOf)
  const attributeOf = (rank: number) => {
    let held = attributes.get(rank)
    if (!held) {
      const accessor = document.accessors[rank]
      const base = build(accessor)
      held = accessor.sparse
        ? pendingAttribute(
            later(COMPONENTS[accessor.componentType], base.count * base.itemSize, () =>
              substitute(base, accessor, viewOf),
            ),
            base.itemSize,
            accessor.normalized,
          )
        : base
      attributes.set(rank, held)
    }
    return held
  }

  return attributeOf
}

/** A copy of one view, as the host loader held it: attributes view into it, never beyond. */
function viewReader(document: TableDocument, binary: PreparedBinary) {
  const views = new Map<number, () => Promise<ArrayBuffer>>()
  return (rank: number) => {
    let held = views.get(rank)
    if (!held) {
      const view = document.views[rank]
      const outside = (bytes: number) =>
        new EngineError('PREPARED_SCENE_MISMATCH', `view ${rank} lies outside the binary`, {
          view: rank,
          bytes,
        })
      held = readOnce(() =>
        typeof binary === 'function'
          ? binary().then((bytes) => {
              if (view.offset + view.length > bytes.byteLength) throw outside(bytes.byteLength)
              return bytes.slice(view.offset, view.offset + view.length)
            })
          : binary.range(view.offset, view.length).then((bytes) => {
              if (bytes.byteLength !== view.length) throw outside(bytes.byteLength)
              return bytes
            }),
      )
      views.set(rank, held)
    }
    return held()
  }
}

/** The host attribute of one accessor, its numbers read from its view on first need. */
function attributeBuilder(document: TableDocument, viewOf: (rank: number) => Promise<ArrayBuffer>) {
  const interleaved = new Map<string, InterleavedBuffer>()
  return (accessor: TableAccessor): Attribute => {
    const Storage = COMPONENTS[accessor.componentType]
    const width = WIDTHS[accessor.type]
    const { view: rank, normalized } = accessor
    const length = accessor.count * width
    if (rank === null) return new BufferAttribute(new Storage(length), width, normalized)
    const stride = document.views[rank].stride
    if (!stride || stride === Storage.BYTES_PER_ELEMENT * width) {
      const read = async () => new Storage(await viewOf(rank), accessor.offset, length)
      return pendingAttribute(later(Storage, length, read), width, normalized)
    }
    // Interleaved: one host buffer per slice of `count` vertices, shared by the runs it holds.
    const slice = Math.floor(accessor.offset / stride)
    const key = `${rank}:${accessor.componentType}:${slice}:${accessor.count}`
    let buffer = interleaved.get(key)
    if (!buffer) {
      const elements = (accessor.count * stride) / Storage.BYTES_PER_ELEMENT
      const read = async () => new Storage(await viewOf(rank), slice * stride, elements)
      buffer = pendingInterleaved(
        later(Storage, elements, read),
        stride / Storage.BYTES_PER_ELEMENT,
      )
      interleaved.set(key, buffer)
    }
    const offset = (accessor.offset % stride) / Storage.BYTES_PER_ELEMENT
    return new InterleavedBufferAttribute(buffer, width, offset, normalized)
  }
}
