/**
 * The geometry layout the scene tables carry for each published scene file (`scene-tables.json`,
 * `packages/asset-compiler-rust/src/compiler_tables/documents.rs`): where every vertex attribute,
 * index list and embedded image of that file sits in the one binary it is published with.
 *
 * A runtime views that binary through these numbers alone — it parses no glTF and decodes nothing
 * the compiler has not already laid out.
 */

/** A slice of the scene file's binary: where it starts, how long it is, and the step between two
 *  vertices when several attributes are interleaved in it. */
interface TableView {
  /** Offset of its first byte in the binary. */
  offset: number;
  /** Its length in bytes. */
  length: number;
  /** Bytes from one vertex to the next when interleaved; `null` when packed. */
  stride: number | null;
}

/** The component types an attribute or an index list is stored in, by their glTF numbers. */
type TableComponentType = 5120 | 5121 | 5122 | 5123 | 5125 | 5126;
/** How many components an element carries, by its glTF name. */
type TableElementType = 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4';

/** One typed run of elements inside a view: a vertex attribute or an index list. */
export interface TableAccessor {
  /** The view it lives in; `null` for a run of zeros. */
  view: number | null;
  /** Offset of its first element inside the view, in bytes. */
  offset: number;
  /** How each component is stored. */
  componentType: TableComponentType;
  /** Whether integers read as 0 to 1 (or -1 to 1). */
  normalized: boolean;
  /** How many elements. */
  count: number;
  /** How many components per element. */
  type: TableElementType;
  /** The lowest value of each component, when declared. */
  min: readonly number[] | null;
  /** The highest value of each component, when declared. */
  max: readonly number[] | null;
}

/** One drawn primitive of a mesh: its attributes by glTF semantic, its index list and the rank of
 *  the surface it wears in the material table. */
interface TablePrimitive {
  /** Accessor rank of each attribute, by glTF semantic (`POSITION`, `TEXCOORD_0`, …). */
  attributes: Readonly<Record<string, number>>;
  /** Accessor rank of the index list, `null` for an unindexed list. */
  indices: number | null;
  /** The surface it wears. */
  material: number;
}

/** A mesh: a name and the primitives it draws. */
interface TableMesh {
  /** Its name. */
  name: string;
  /** What it draws. */
  primitives: readonly TablePrimitive[];
}

/** An image a texture samples: an address beside the scene file, or a view of its binary. */
interface TableImage {
  /** Its name. */
  name: string;
  /** Its address, relative to the scene file; `null` when it lives in the binary. */
  uri: string | null;
  /** The view that holds its bytes; `null` when it has an address. */
  view: number | null;
  /** Its media type, when declared. */
  mimeType: string | null;
}

/** The layout of one published scene file, and the binary it is read from. */
export interface TableDocument {
  /** The binary, beside the scene file. */
  buffer: string;
  /** Its slices. */
  views: readonly TableView[];
  /** Its typed runs. */
  accessors: readonly TableAccessor[];
  /** Its meshes, at their glTF rank. */
  meshes: readonly TableMesh[];
  /** Its images, at their glTF rank. */
  images: readonly TableImage[];
}
