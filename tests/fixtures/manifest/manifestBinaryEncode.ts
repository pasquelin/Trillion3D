// The unit tests' manifest encoder, no native compile; its header words are the compiler's.
import type { ClusterManifest } from '../../../packages/sdk-core/src/contracts/geometry.ts'
import * as format from '../../../packages/sdk-core/src/manifest/binaryFormat.ts'
import * as written from '../../../packages/sdk-core/src/contracts/writtenFormats.ts'
import { countManifest, slimBinaryOf, writeSha } from './manifestBinaryEncodeChecks.ts'
import { manifestBinaryRanges } from './manifestBinaryRanges.ts'
import { encodePreviewColumns } from './manifestBinaryPreviewEncode.ts'
import { pageColumns, writePage } from './manifestBinaryPageEncode.ts'
import type {
  GeometryFile,
  ManifestBinaryDescriptor,
  SlimClusterManifest,
  SlimPrimitive,
} from '../../../packages/sdk-core/src/manifest/binaryTypes.ts'
import { EngineError } from '../../../packages/sdk-core/src/contracts/cache.ts'

/** Splits a manifest into its JSON and mapped columns, its bundles lying in `geometryFiles`; the
 *  caller hashes the bytes for `sha256`. */
export function encodeManifestBinary(
  manifest: ClusterManifest,
  {
    geometryFiles,
    ...descriptor
  }: Pick<ManifestBinaryDescriptor, 'url'> & {
    geometryFiles: GeometryFile[]
  },
): { manifest: SlimClusterManifest; binary: Uint8Array } {
  const counts = countManifest(manifest)
  const { ranges, bytes } = manifestBinaryRanges(counts)
  const buffer = new ArrayBuffer(bytes)
  const headerWords = written.MANIFEST_BINARY_HEADER_WORDS
  const header = new Uint32Array(buffer, 0, headerWords + format.COLUMN_NAMES.length * 2)
  header[0] = written.MANIFEST_BINARY_MAGIC
  header[1] = written.MANIFEST_BINARY_VERSION
  header[2] = format.COLUMN_NAMES.length
  format.COLUMN_NAMES.forEach((name, index) => {
    header[headerWords + index * 2] = ranges[name].offset
    header[headerWords + index * 2 + 1] = ranges[name].length
  })
  const view = <T>(name: format.ColumnName, make: (b: ArrayBuffer, o: number, n: number) => T): T =>
    make(
      buffer,
      ranges[name].offset,
      ranges[name].length / format.BYTES_PER_ELEMENT[format.COLUMN_KIND[name]],
    )
  const columns = pageColumns(view)
  const cullingNodes = view('cullingNodes', (b, o, n) => new Float64Array(b, o, n))
  const groupLevel = view('groupLevel', (b, o, n) => new Int32Array(b, o, n)),
    groupError = view('groupError', (b, o, n) => new Float64Array(b, o, n))
  const groupSphere = view('groupSphere', (b, o, n) => new Float64Array(b, o, n))
  const groupChildCount = view('groupChildCount', (b, o, n) => new Int32Array(b, o, n)),
    groupChild = view('groupChild', (b, o, n) => new Int32Array(b, o, n))
  const groupOutputCount = view('groupOutputCount', (b, o, n) => new Int32Array(b, o, n)),
    groupOutput = view('groupOutput', (b, o, n) => new Int32Array(b, o, n))
  const structureRoot = view('structureRoot', (b, o, n) => new Int32Array(b, o, n))
  const bundleWords = view('bundleU32', (b, o, n) => new Uint32Array(b, o, n)),
    bundleSha = view('bundleSha', (b, o, n) => new Uint8Array(b, o, n))
  const words32 = (b: ArrayBuffer, o: number, n: number) => new Uint32Array(b, o, n)
  const dependencyCount = view('bundleDependencyCount', words32),
    dependencyList = view('bundleDependency', words32)
  encodePreviewColumns(manifest.texturePreviews ?? [], view)
  let page = 0,
    node = 0,
    group = 0,
    child = 0,
    output = 0,
    root = 0,
    bundle = 0,
    dependency = 0
  const primitives: SlimPrimitive[] = manifest.primitives.map((primitive) => {
    for (const item of primitive.pages) {
      writePage(columns, page, item)
      page++
    }
    if (primitive.culling) {
      cullingNodes.set(primitive.culling.nodes, node * 15)
      node += primitive.culling.count
    }
    for (const item of primitive.structure?.groups ?? []) {
      groupLevel[group] = item.level
      groupError[group] = item.error
      groupSphere.set(item.sphere, group * 4)
      groupChildCount[group] = item.children.length
      groupChild.set(item.children, child)
      child += item.children.length
      groupOutputCount[group] = item.outputs.length
      groupOutput.set(item.outputs, output)
      output += item.outputs.length
      group++
    }
    if (primitive.structure) {
      structureRoot.set(primitive.structure.roots, root)
      root += primitive.structure.roots.length
    }
    for (const item of primitive.streams?.pages ?? []) {
      const file = geometryFiles.findIndex(({ url }) => url === item.range?.file)
      if (!item.range || file < 0)
        throw new EngineError('INVALID_CACHE', 'A bundle lies in no geometry file', { bundle })
      writeSha(bundleSha, bundle, item.sha256)
      bundleWords.set([file, item.range.offset, item.bytes, item.count], bundle * 4)
      dependencyCount[bundle] = item.dependencies.length
      dependencyList.set(item.dependencies, dependency)
      dependency += item.dependencies.length
      bundle++
    }
    const {
      pages: _pages,
      culling: _culling,
      structure: _structure,
      streams: _streams,
      ...rest
    } = primitive
    const slim = slimBinaryOf(primitive)
    return { ...rest, binary: slim } as SlimPrimitive
  })
  const { primitives: _ignored, ...top } = manifest
  return {
    manifest: {
      ...top,
      geometryFiles,
      binary: {
        ...descriptor,
        version: written.MANIFEST_BINARY_VERSION,
        sha256: '',
        bytes,
        texturePreviews: counts.previews,
        texturePreviewBytes: counts.previewBytes,
        texturePreviewBc7Bytes: counts.previewBlockBytes.bc7,
        texturePreviewAstcBytes: counts.previewBlockBytes.astc,
        texturePreviewEtc2Bytes: counts.previewBlockBytes.etc2,
      },
      primitives,
    } as SlimClusterManifest,
    binary: new Uint8Array(buffer),
  }
}
