import { EngineError } from '../contracts/cache.ts'
import type {
  ClusterGroup,
  ClusterStructure,
  CullingHierarchy,
  StreamBundle,
  StreamCatalogue,
} from '../contracts/geometry.ts'
import { streamBundleAddress } from '../page/contracts.ts'
import * as format from './binaryFormat.ts'
import type { GeometryFile, SlimPrimitiveBinary } from './binaryTypes.ts'

/** Where the walk over the shared columns currently is. Each decoder advances its own cursor. */
export interface PartCursors {
  node: number
  group: number
  child: number
  output: number
  root: number
  bundle: number
  dependency: number
}

/** The bundle columns: four words, a digest and a dependency list per bundle. */
export interface BundleColumns {
  bundleWords: Uint32Array
  bundleShaText: string
  bundleDependencyCount: Uint32Array
  bundleDependency: Uint32Array
}

export interface GroupColumns {
  groupLevel: Int32Array
  groupError: Float64Array
  groupSphere: Float64Array
  groupChildCount: Int32Array
  groupOutputCount: Int32Array
  groupChild: Int32Array
  groupOutput: Int32Array
  structureRoot: Int32Array
}

/** The flat culling hierarchy of one primitive. Its stride is the format, so a foreign one is refused. */
export function decodeCulling(
  binary: SlimPrimitiveBinary,
  nodes: Float64Array,
  cursors: PartCursors,
): CullingHierarchy | null | undefined {
  if (binary.culling === undefined) return undefined
  if (binary.culling === null) return null
  const { stride, count } = binary.culling
  if (stride !== 15)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      'Manifest binary culling stride differs from this version',
      { stride },
    )
  const decoded = {
    stride,
    count,
    nodes: Array.from(nodes.subarray(cursors.node * 15, (cursors.node + count) * 15)),
  }
  cursors.node += count
  return decoded
}

/** The group links of one primitive: which clusters a group replaces, and which it produces. */
export function decodeStructure(
  binary: SlimPrimitiveBinary,
  columns: GroupColumns,
  cursors: PartCursors,
): ClusterStructure | null | undefined {
  if (binary.structure === undefined) return undefined
  if (binary.structure === null) return null
  const groups: ClusterGroup[] = new Array(binary.structure.groups)
  for (let g = 0; g < binary.structure.groups; g++, cursors.group++) {
    const slot = cursors.group
    const children = Array.from(
      columns.groupChild.subarray(cursors.child, cursors.child + columns.groupChildCount[slot]),
    )
    cursors.child += columns.groupChildCount[slot]
    const outputs = Array.from(
      columns.groupOutput.subarray(cursors.output, cursors.output + columns.groupOutputCount[slot]),
    )
    cursors.output += columns.groupOutputCount[slot]
    groups[g] = {
      level: columns.groupLevel[slot],
      error: columns.groupError[slot],
      sphere: [
        columns.groupSphere[slot * 4],
        columns.groupSphere[slot * 4 + 1],
        columns.groupSphere[slot * 4 + 2],
        columns.groupSphere[slot * 4 + 3],
      ],
      children,
      outputs,
    }
  }
  const roots = Array.from(
    columns.structureRoot.subarray(cursors.root, cursors.root + binary.structure.roots),
  )
  cursors.root += binary.structure.roots
  return { version: binary.structure.version, roots, groups }
}

/** The streaming bundles of one primitive, each a range of the container `files` names at its
 *  rank, named in the catalogue by where it lies (`streamBundleAddress`). */
export function decodeStreams(
  binary: SlimPrimitiveBinary,
  { bundleWords: words, bundleShaText: shaText, ...lists }: BundleColumns,
  files: readonly GeometryFile[],
  cursors: PartCursors,
): StreamCatalogue | undefined {
  if (!binary.streams) return undefined
  const pages: StreamBundle[] = new Array(binary.streams.pages)
  for (let b = 0; b < binary.streams.pages; b++, cursors.bundle++) {
    const at = cursors.bundle * 4,
      file = files[words[at + format.BUNDLE_FILE]]
    if (!file)
      throw new EngineError(
        'INVALID_CACHE',
        'A bundle lies in a geometry file the manifest lacks',
        {
          bundle: b,
        },
      )
    const offset = words[at + format.BUNDLE_OFFSET],
      count = lists.bundleDependencyCount[cursors.bundle]
    pages[b] = {
      url: streamBundleAddress(file.url, offset),
      range: { file: file.url, offset },
      sha256: shaText.substring(cursors.bundle * 64, cursors.bundle * 64 + 64),
      bytes: words[at + format.BUNDLE_BYTES],
      count: words[at + format.BUNDLE_COUNT],
      dependencies: Array.from(
        lists.bundleDependency.subarray(cursors.dependency, (cursors.dependency += count)),
      ),
    }
  }
  return {
    version: binary.streams.version,
    pinned: binary.streams.pinned,
    bundleBytes: binary.streams.bundleBytes,
    dependencyBound: binary.streams.dependencyBound,
    maxDependencies: binary.streams.maxDependencies,
    pages,
  }
}
