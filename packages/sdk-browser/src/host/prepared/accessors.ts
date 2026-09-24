/**
 * The host attributes of the prepared scene's accessors, viewed on the binary the scene tables
 * lay out, under the host loader's rules: an attribute is viewed inside a copy of its view; an
 * interleaved view is one host buffer per slice of vertices; a sparse accessor is a copy of its
 * base with the substituted elements written in; a run shared by two primitives is one attribute.
 */
import { EngineError } from '../../../../sdk-core/src/index.ts';
import type {
  TableAccessor,
  TableDocument,
} from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import {
  GraphAttribute,
  GraphInterleavedAttribute,
  GraphInterleavedBuffer,
  type GraphElements,
} from '../graph/attributes.ts';

/** Storage of each glTF component type. */
const COMPONENTS = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
} as const;
/** Components per element of each glTF element type. */
const WIDTHS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 } as const;
/** What one unit of a normalised integer is worth: the scale a declared box is read at. */
export const NORMALISED: Partial<Record<keyof typeof COMPONENTS, number>> = {
  5120: 1 / 127,
  5121: 1 / 255,
  5122: 1 / 32767,
  5123: 1 / 65535,
};

type Attribute = GraphElements;

/** Writes the substituted elements of a sparse accessor into a copy of its base, as the loader does. */
function substitute(
  base: Attribute,
  accessor: TableAccessor,
  viewOf: (rank: number) => ArrayBuffer,
): Attribute {
  const sparse = accessor.sparse!;
  const width = base.itemSize;
  const Ranks = COMPONENTS[sparse.indices.componentType];
  const Values = COMPONENTS[accessor.componentType];
  const ranks = new Ranks(viewOf(sparse.indices.view), sparse.indices.offset, sparse.count);
  const values = new Values(viewOf(sparse.values.view), sparse.values.offset, sparse.count * width);
  const out =
    accessor.view === null
      ? (base as GraphAttribute)
      : new GraphAttribute(base.array.slice(), width, base.normalized);
  out.normalized = false;
  for (let i = 0; i < ranks.length; i++) {
    out.setX(ranks[i], values[i * width]);
    if (width >= 2) out.setY(ranks[i], values[i * width + 1]);
    if (width >= 3) out.setZ(ranks[i], values[i * width + 2]);
    if (width >= 4) out.setW(ranks[i], values[i * width + 3]);
  }
  out.normalized = accessor.normalized;
  return out;
}

/** The host attribute of each accessor of `document`, built on first request and shared after it.
 *  `binary` is the document's buffer; `null` only for a document that lays out no view. */
export function preparedAccessors(document: TableDocument, binary: ArrayBuffer | null) {
  const views = new Map<number, ArrayBuffer>();
  const attributes = new Map<number, Attribute>();
  const interleaved = new Map<string, GraphInterleavedBuffer>();

  /** A copy of one view, as the host loader held it: attributes view into it, never beyond. */
  const viewOf = (rank: number) => {
    let held = views.get(rank);
    if (!held) {
      const view = document.views[rank];
      if (!binary || view.offset + view.length > binary.byteLength)
        throw new EngineError('PREPARED_SCENE_MISMATCH', `view ${rank} lies outside the binary`, {
          view: rank,
          bytes: binary?.byteLength ?? 0,
        });
      held = binary.slice(view.offset, view.offset + view.length);
      views.set(rank, held);
    }
    return held;
  };

  const build = (accessor: TableAccessor): Attribute => {
    const Storage = COMPONENTS[accessor.componentType];
    const width = WIDTHS[accessor.type];
    const stride = accessor.view === null ? null : document.views[accessor.view].stride;
    const itemBytes = Storage.BYTES_PER_ELEMENT * width;
    if (accessor.view === null)
      return new GraphAttribute(new Storage(accessor.count * width), width, accessor.normalized);
    const view = viewOf(accessor.view);
    if (!stride || stride === itemBytes)
      return new GraphAttribute(
        new Storage(view, accessor.offset, accessor.count * width),
        width,
        accessor.normalized,
      );
    // Interleaved: one host buffer per slice of `count` vertices, shared by the runs it holds.
    const slice = Math.floor(accessor.offset / stride);
    const key = `${accessor.view}:${accessor.componentType}:${slice}:${accessor.count}`;
    let buffer = interleaved.get(key);
    if (!buffer) {
      const elements = (accessor.count * stride) / Storage.BYTES_PER_ELEMENT;
      buffer = new GraphInterleavedBuffer(
        new Storage(view, slice * stride, elements),
        stride / Storage.BYTES_PER_ELEMENT,
      );
      interleaved.set(key, buffer);
    }
    const offset = (accessor.offset % stride) / Storage.BYTES_PER_ELEMENT;
    return new GraphInterleavedAttribute(buffer, width, offset, accessor.normalized);
  };

  const attributeOf = (rank: number) => {
    let held = attributes.get(rank);
    if (!held) {
      const accessor = document.accessors[rank];
      held = build(accessor);
      if (accessor.sparse) held = substitute(held, accessor, viewOf);
      attributes.set(rank, held);
    }
    return held;
  };

  return attributeOf;
}
