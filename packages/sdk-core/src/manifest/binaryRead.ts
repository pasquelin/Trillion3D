import { EngineError } from '../contracts/cache.ts'
import {
  BYTES_PER_ELEMENT,
  COLUMN_KIND,
  COLUMN_NAMES,
  COLUMN_STRIDE,
  columnCountOf,
  type ColumnName,
} from './binaryFormat.ts'
import { MANIFEST_BINARY_HEADER_WORDS, MANIFEST_BINARY_MAGIC } from '../contracts/writtenFormats.ts'
import { columnElements, type Counts } from './binaryLayout.ts'
import {
  assertManifestBinary,
  READ_MANIFEST_VERSIONS,
  readsManifestBinaryVersion,
  type SlimClusterManifest,
} from './binaryTypes.ts'

/** Checks the header of the binary against the versions read and returns it with the columns its
 *  version holds. */
function readHeader(buffer: ArrayBuffer) {
  const holds = (words: number) => {
    if (buffer.byteLength < words * 4)
      throw new EngineError('INVALID_CACHE', 'Manifest binary is shorter than its header', {
        bytes: buffer.byteLength,
      })
  }
  holds(MANIFEST_BINARY_HEADER_WORDS)
  const fixed = new Uint32Array(buffer, 0, MANIFEST_BINARY_HEADER_WORDS)
  if (fixed[0] !== MANIFEST_BINARY_MAGIC)
    throw new EngineError('INVALID_CACHE', 'Manifest binary has no WGMB signature', {
      magic: fixed[0],
    })
  if (!readsManifestBinaryVersion(fixed[1]))
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `Expected manifest binary version ${READ_MANIFEST_VERSIONS.join(', ')}, received ${fixed[1]}`,
      { version: fixed[1] },
    )
  const columns = columnCountOf(fixed[1])
  holds(MANIFEST_BINARY_HEADER_WORDS + columns * 2)
  if (fixed[2] !== columns)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      'Manifest binary column count differs from this version',
      { columns: fixed[2], expected: columns },
    )
  return {
    header: new Uint32Array(buffer, 0, MANIFEST_BINARY_HEADER_WORDS + columns * 2),
    names: COLUMN_NAMES.slice(0, columns),
  }
}

/** The element counts the small JSON declares; the group members are added once their columns are read. */
function declaredCounts(slim: SlimClusterManifest) {
  const counts: Counts = {
    pages: 0,
    cullingNodes: 0,
    groups: 0,
    children: 0,
    outputs: 0,
    roots: 0,
    bundles: 0,
    bundleDependencies: 0,
    previews: slim.binary.texturePreviews,
    previewBytes: slim.binary.texturePreviewBytes,
    previewBlockBytes: {
      bc7: slim.binary.texturePreviewBc7Bytes,
      astc: slim.binary.texturePreviewAstcBytes,
      etc2: slim.binary.texturePreviewEtc2Bytes,
    },
  }
  for (const primitive of slim.primitives) {
    const binary = primitive.binary
    if (!binary || !Number.isSafeInteger(binary.pages) || binary.pages < 0)
      throw new EngineError('INVALID_CACHE', 'A primitive has no binary page count', {
        mesh: primitive.mesh,
        primitive: primitive.primitive,
      })
    counts.pages += binary.pages
    counts.cullingNodes += binary.culling?.count ?? 0
    counts.groups += binary.structure?.groups ?? 0
    counts.roots += binary.structure?.roots ?? 0
    counts.bundles += binary.streams?.pages ?? 0
  }
  return counts
}

type Maker<T> = (b: ArrayBuffer, o: number, n: number) => T
type Column = <T>(name: ColumnName, make: Maker<T>) => T

/** The checked access to the columns of `buffer` that `header` places. */
function columnsOf(buffer: ArrayBuffer, header: Uint32Array) {
  const at = (index: number) => ({
    offset: header[MANIFEST_BINARY_HEADER_WORDS + index * 2],
    length: header[MANIFEST_BINARY_HEADER_WORDS + index * 2 + 1],
  })
  const column = <T>(name: ColumnName, make: (b: ArrayBuffer, o: number, n: number) => T): T => {
    const index = COLUMN_NAMES.indexOf(name),
      { offset, length } = at(index)
    const element = BYTES_PER_ELEMENT[COLUMN_KIND[name]]
    if (offset % 8 !== 0 || length % element !== 0 || offset + length > buffer.byteLength)
      throw new EngineError('INVALID_CACHE', `Manifest binary column ${name} is out of bounds`, {
        column: name,
        offset,
        length,
        bytes: buffer.byteLength,
      })
    return make(buffer, offset, length / element)
  }
  const expect = (name: ColumnName, elements: number) => {
    const { length } = at(COLUMN_NAMES.indexOf(name))
    const wanted = elements * COLUMN_STRIDE[name] * BYTES_PER_ELEMENT[COLUMN_KIND[name]]
    if (length !== wanted)
      throw new EngineError(
        'INVALID_CACHE',
        `Manifest binary column ${name} does not match the declared counts`,
        { column: name, length, expected: wanted },
      )
  }
  return { column: column as Column, expect }
}

/** Adds up the members of the groups: the flat child and output arrays are as long as these say. */
function addGroupMembers(
  counts: Counts,
  groupChildCount: Int32Array,
  groupOutputCount: Int32Array,
) {
  for (let g = 0; g < counts.groups; g++) {
    if (groupChildCount[g] < 0 || groupOutputCount[g] < 0)
      throw new EngineError('INVALID_CACHE', 'A group declares a negative member count', {
        group: g,
      })
    counts.children += groupChildCount[g]
    counts.outputs += groupOutputCount[g]
  }
}

function readPages(column: Column) {
  return {
    bounds: column('pageBounds', (b, o, n) => new Float64Array(b, o, n)),
    sphere: column('pageSphere', (b, o, n) => new Float64Array(b, o, n)),
    parentSphere: column('pageParentSphere', (b, o, n) => new Float64Array(b, o, n)),
    error: column('pageError', (b, o, n) => new Float64Array(b, o, n)),
    ints: column('pageInt', (b, o, n) => new Int32Array(b, o, n)),
    words: column('pageU32', (b, o, n) => new Uint32Array(b, o, n)),
    geometryWords: column('geometryU32', (b, o, n) => new Uint32Array(b, o, n)),
    pageDepthLayer: column('pageDepthLayer', (b, o, n) => new Uint32Array(b, o, n)),
  }
}

function readGroups(column: Column, groupChildCount: Int32Array, groupOutputCount: Int32Array) {
  return {
    groupLevel: column('groupLevel', (b, o, n) => new Int32Array(b, o, n)),
    groupError: column('groupError', (b, o, n) => new Float64Array(b, o, n)),
    groupSphere: column('groupSphere', (b, o, n) => new Float64Array(b, o, n)),
    groupChildCount,
    groupOutputCount,
    groupChild: column('groupChild', (b, o, n) => new Int32Array(b, o, n)),
    groupOutput: column('groupOutput', (b, o, n) => new Int32Array(b, o, n)),
    structureRoot: column('structureRoot', (b, o, n) => new Int32Array(b, o, n)),
  }
}

/** The bundle columns; `bundleDecodedBytes` is there from `DECODED_BYTES_VERSION` on. */
function readBundles(column: Column, bundleDependencyCount: Uint32Array, decoded: boolean) {
  const decoder = new TextDecoder('latin1')
  return {
    bundleWords: column('bundleU32', (b, o, n) => new Uint32Array(b, o, n)),
    bundleShaText: decoder.decode(column('bundleSha', (b, o, n) => new Uint8Array(b, o, n))),
    bundleDependencyCount,
    bundleDependency: column('bundleDependency', (b, o, n) => new Uint32Array(b, o, n)),
    bundleDecodedBytes: decoded
      ? column('bundleDecodedBytes', (b, o, n) => new Uint32Array(b, o, n))
      : undefined,
  }
}

function readPreviews(column: Column, count: number) {
  const bytes = (name: ColumnName) => column(name, (b, o, n) => new Uint8Array(b, o, n))
  return {
    count,
    previewWords: column('texturePreviewU32', (b, o, n) => new Uint32Array(b, o, n)),
    previewShaText: new TextDecoder('latin1').decode(bytes('texturePreviewSha')),
    previewPixels: bytes('texturePreviewPixels'),
    previewBlocks: {
      bc7: bytes('texturePreviewBc7'),
      astc: bytes('texturePreviewAstc'),
      etc2: bytes('texturePreviewEtc2'),
    },
  }
}

export function readManifestColumns(slim: SlimClusterManifest, buffer: ArrayBuffer) {
  assertManifestBinary(slim.binary)
  const { header, names } = readHeader(buffer)
  const counts = declaredCounts(slim)
  const { column, expect } = columnsOf(buffer, header)
  // The flat child and output arrays are as long as the per-group counts say; everything else is
  // fixed by the counts the small JSON declares, so every column is checked before a byte is read.
  expect('groupChildCount', counts.groups)
  expect('groupOutputCount', counts.groups)
  const groupChildCount = column('groupChildCount', (b, o, n) => new Int32Array(b, o, n)),
    groupOutputCount = column('groupOutputCount', (b, o, n) => new Int32Array(b, o, n))
  addGroupMembers(counts, groupChildCount, groupOutputCount)
  expect('bundleDependencyCount', counts.bundles)
  const bundleDependencyCount = column(
    'bundleDependencyCount',
    (b, o, n) => new Uint32Array(b, o, n),
  )
  for (let b = 0; b < counts.bundles; b++) counts.bundleDependencies += bundleDependencyCount[b]
  for (const name of names) expect(name, columnElements(name, counts))
  return {
    pages: readPages(column),
    groups: readGroups(column, groupChildCount, groupOutputCount),
    bundles: readBundles(column, bundleDependencyCount, names.includes('bundleDecodedBytes')),
    previews: readPreviews(column, counts.previews),
    cullingNodes: column('cullingNodes', (b, o, n) => new Float64Array(b, o, n)),
  }
}
