import type { ClusterManifest, Page, Primitive } from '../contracts/geometry.ts'
import {
  geometryPageAddress,
  packedPageAddress,
  type GeometryPageDescriptor,
} from '../page/contracts.ts'
import { EngineError } from '../contracts/cache.ts'
import { decodeCulling, decodeStreams, decodeStructure } from './binaryDecodeParts.ts'
import { decodeTexturePreviews } from './binaryPreview.ts'
import * as format from './binaryFormat.ts'
import {
  FLAG_ROLE,
  FLAG_COARSE,
  FLAG_CLUSTER_ERROR,
  FLAG_PARENT_ERROR,
  FLAG_PARENT_ERROR_FINITE,
  FLAG_PARENT_SPHERE,
  FLAG_PARENT_SPHERE_SET,
  FLAG_GROUP,
  FLAG_SOURCE,
} from './binaryPageWords.ts'
import { readManifestColumns } from './binaryRead.ts'
import type { SlimClusterManifest } from './binaryTypes.ts'
type PageColumns = ReturnType<typeof readManifestColumns>['pages']
type Streams = ReturnType<typeof decodeStreams>

/** The optional fields a page's flag word says it carries: its role, start, level, cluster error and
 *  sphere, parent error and sphere, group, source and depth layer. */
function readPageFlags(item: Page, page: number, flags: number, columns: PageColumns) {
  const { sphere, parentSphere, error, ints, pageDepthLayer } = columns
  const base = page * 8
  if (flags & FLAG_ROLE) item.role = flags & FLAG_COARSE ? 'coarse' : 'exact'
  if (ints[base + format.INT_START] >= 0) item.start = ints[base + format.INT_START]
  if (ints[base + format.INT_LEVEL] >= 0) item.level = ints[base + format.INT_LEVEL]
  if (flags & FLAG_CLUSTER_ERROR) {
    item.lodError = error[page * 2]
    item.sphere = [
      sphere[page * 4],
      sphere[page * 4 + 1],
      sphere[page * 4 + 2],
      sphere[page * 4 + 3],
    ]
  }
  if (flags & FLAG_PARENT_ERROR)
    item.parentError = flags & FLAG_PARENT_ERROR_FINITE ? error[page * 2 + 1] : null
  if (flags & FLAG_PARENT_SPHERE)
    item.parentSphere =
      flags & FLAG_PARENT_SPHERE_SET
        ? [
            parentSphere[page * 4],
            parentSphere[page * 4 + 1],
            parentSphere[page * 4 + 2],
            parentSphere[page * 4 + 3],
          ]
        : null
  if (flags & FLAG_GROUP)
    item.group = ints[base + format.INT_GROUP] >= 0 ? ints[base + format.INT_GROUP] : null
  if (flags & FLAG_SOURCE)
    item.source = ints[base + format.INT_SOURCE] >= 0 ? ints[base + format.INT_SOURCE] : null
  // Layer 0 is the untouched draw; leaving the field out keeps one shape for every page record.
  if (pageDepthLayer[page] > 0) item.depthLayer = pageDepthLayer[page]
}

/** The page `page` of the columns: its geometry page, its bounds and the fields its flags carry. */
function decodePage(page: number, columns: PageColumns, streams: Streams): Page {
  const { bounds, ints, words, geometryWords } = columns
  const flags = words[page],
    base = page * 8,
    at = page * format.COLUMN_STRIDE.geometryU32
  const stream = ints[base + format.INT_STREAM],
    bundle = streams?.pages[stream]
  if (!bundle)
    throw new EngineError('INVALID_CACHE', 'A page lies in no bundle of its primitive', {
      page,
      stream,
    })
  const offset = ints[base + format.INT_STREAM_OFFSET],
    { file, offset: bundleOffset } = bundle.range!
  const geometry: GeometryPageDescriptor = {
    url:
      bundle.decodedBytes === undefined
        ? geometryPageAddress(file, bundleOffset + offset)
        : packedPageAddress(file, bundleOffset, offset),
    bundle: { url: bundle.url, offset },
    sha256: bundle.sha256,
    bytes: geometryWords[at + format.GEOMETRY_BYTES],
    residentBytes: geometryWords[at + format.GEOMETRY_RESIDENT_BYTES],
    residentOffset: geometryWords[at + format.GEOMETRY_RESIDENT_OFFSET],
    vertexCount: geometryWords[at + format.GEOMETRY_VERTICES],
    indexCount: geometryWords[at + format.GEOMETRY_INDICES],
    flags: geometryWords[at + format.GEOMETRY_FLAGS],
    uncompressedBytes: geometryWords[at + format.GEOMETRY_UNCOMPRESSED],
  }
  const item: Page = {
    id: ints[base + format.INT_ID],
    url: geometry.url,
    sha256: geometry.sha256,
    bytes: geometry.bytes,
    count: ints[base + format.INT_COUNT],
    min: [bounds[page * 6], bounds[page * 6 + 1], bounds[page * 6 + 2]],
    max: [bounds[page * 6 + 3], bounds[page * 6 + 4], bounds[page * 6 + 5]],
    geometry,
    stream,
    streamOffset: offset,
  }
  readPageFlags(item, page, flags, columns)
  return item
}

/** Turns a binary manifest back into the full manifest a runtime reads. A page is read as its
 *  geometry page, a slice of its streaming bundle — a range of the container `slim.geometryFiles`
 *  names at its rank —: its `url` names where it lies (`geometryPageAddress`, or
 *  `packedPageAddress` in a compressed bundle), its `bytes` are its own and its `sha256` the
 *  bundle's, which proves it. */
export function decodeManifestBinary(
  slim: SlimClusterManifest,
  buffer: ArrayBuffer,
): ClusterManifest {
  const {
    pages: pageColumns,
    groups: groupColumns,
    bundles,
    previews,
    cullingNodes,
  } = readManifestColumns(slim, buffer)
  const files = slim.geometryFiles ?? []
  const cursors = { node: 0, group: 0, child: 0, output: 0, root: 0, bundle: 0, dependency: 0 }
  let page = 0
  const primitives: Primitive[] = slim.primitives.map((entry) => {
    const binary = entry.binary
    const streams = decodeStreams(binary, bundles, files, cursors)
    const pages: Page[] = new Array(binary.pages)
    for (let i = 0; i < binary.pages; i++, page++) {
      pages[i] = decodePage(page, pageColumns, streams)
    }
    const culling = decodeCulling(binary, cullingNodes, cursors)
    const structure = decodeStructure(binary, groupColumns, cursors)
    const { binary: _ignored, ...rest } = entry
    const result = { ...rest, pages } as Primitive
    if (culling !== undefined) result.culling = culling
    if (structure !== undefined) result.structure = structure
    if (streams !== undefined) result.streams = streams
    return result
  })
  const { binary: _descriptor, primitives: _slimPrimitives, geometryFiles: _files, ...top } = slim
  const file = slim.binary.texturePreviewPixels
  return {
    ...top,
    primitives,
    texturePreviews: decodeTexturePreviews({ ...previews, externalPixelBytes: file?.bytes }),
    ...(file && { texturePreviewPixels: file }),
  } as ClusterManifest
}
