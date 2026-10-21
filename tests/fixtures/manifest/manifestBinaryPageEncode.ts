// The page columns of the unit tests' manifest encoder (`manifestBinaryEncode.ts`): their views,
// and one page's fields written into them.
import type { ClusterManifest } from '../../../packages/sdk-core/src/contracts/geometry.ts'
import * as format from '../../../packages/sdk-core/src/manifest/binaryFormat.ts'
import * as pageFlags from '../../../packages/sdk-core/src/manifest/binaryPageWords.ts'
import { EngineError } from '../../../packages/sdk-core/src/contracts/cache.ts'
import { checkedDepthLayer } from './manifestBinaryEncodeChecks.ts'
import type { ColumnView } from './manifestBinaryPreviewEncode.ts'

/** The columns a page writes, from an encoder that hands out views by column name. */
export function pageColumns(view: ColumnView) {
  const bounds = view('pageBounds', (b, o, n) => new Float64Array(b, o, n)),
    sphere = view('pageSphere', (b, o, n) => new Float64Array(b, o, n))
  const parentSphere = view('pageParentSphere', (b, o, n) => new Float64Array(b, o, n)),
    error = view('pageError', (b, o, n) => new Float64Array(b, o, n))
  const ints = view('pageInt', (b, o, n) => new Int32Array(b, o, n)),
    words = view('pageU32', (b, o, n) => new Uint32Array(b, o, n))
  const geometryWords = view('geometryU32', (b, o, n) => new Uint32Array(b, o, n))
  const pageDepthLayer = view('pageDepthLayer', (b, o, n) => new Uint32Array(b, o, n))
  return {
    bounds,
    sphere,
    parentSphere,
    error,
    ints,
    words,
    geometryWords,
    pageDepthLayer,
  }
}

type Page = ClusterManifest['primitives'][number]['pages'][number]

/** Writes page `item` at row `page` of `columns`: its bounds, errors, spheres, integers, geometry,
 *  flags and depth layer. */
export function writePage(columns: ReturnType<typeof pageColumns>, page: number, item: Page) {
  const { bounds, sphere, parentSphere, error, ints, words, geometryWords, pageDepthLayer } =
    columns
  bounds.set(item.min, page * 6)
  bounds.set(item.max, page * 6 + 3)
  let flags = 0
  if (item.role !== undefined) {
    flags |= pageFlags.FLAG_ROLE
    if (item.role === 'coarse') flags |= pageFlags.FLAG_COARSE
  }
  if (typeof item.lodError === 'number' && Array.isArray(item.sphere)) {
    flags |= pageFlags.FLAG_CLUSTER_ERROR
    error[page * 2] = item.lodError
    sphere.set(item.sphere, page * 4)
  }
  if (item.parentError !== undefined) {
    flags |= pageFlags.FLAG_PARENT_ERROR
    if (typeof item.parentError === 'number') {
      flags |= pageFlags.FLAG_PARENT_ERROR_FINITE
      error[page * 2 + 1] = item.parentError
    }
  }
  if (item.parentSphere !== undefined) {
    flags |= pageFlags.FLAG_PARENT_SPHERE
    if (item.parentSphere !== null) {
      flags |= pageFlags.FLAG_PARENT_SPHERE_SET
      parentSphere.set(item.parentSphere, page * 4)
    }
  }
  ints[page * 8 + format.INT_ID] = item.id
  ints[page * 8 + format.INT_LEVEL] = item.level ?? -1
  if (item.group !== undefined) {
    flags |= pageFlags.FLAG_GROUP
    ints[page * 8 + format.INT_GROUP] = item.group ?? -1
  } else ints[page * 8 + format.INT_GROUP] = -1
  if (item.source !== undefined) {
    flags |= pageFlags.FLAG_SOURCE
    ints[page * 8 + format.INT_SOURCE] = item.source ?? -1
  } else ints[page * 8 + format.INT_SOURCE] = -1
  ints[page * 8 + format.INT_STREAM] = item.stream ?? -1
  ints[page * 8 + format.INT_STREAM_OFFSET] = item.streamOffset ?? -1
  ints[page * 8 + format.INT_COUNT] = item.count
  ints[page * 8 + format.INT_START] = item.start ?? -1
  const geometry = item.geometry
  if (!geometry?.bundle)
    throw new EngineError('INVALID_CACHE', 'A page lies in no bundle', { id: item.id })
  geometryWords.set(
    [
      geometry.bytes,
      geometry.vertexCount,
      geometry.indexCount,
      geometry.flags,
      geometry.uncompressedBytes,
    ],
    page * 5,
  )
  words[page] = flags
  if (item.depthLayer !== undefined) pageDepthLayer[page] = checkedDepthLayer(item.depthLayer)
}
