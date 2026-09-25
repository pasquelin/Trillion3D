import {
  EngineError,
  type ClusterGroup,
  type ClusterStructure,
  type CullingHierarchy,
  type StreamBundle,
  type StreamCatalogue,
} from '../contracts/index.ts';
import type { SlimPrimitiveBinary } from './binaryTypes.ts';

/** Where the walk over the shared columns currently is. Each decoder advances its own cursor. */
export interface PartCursors {
  node: number;
  group: number;
  child: number;
  output: number;
  root: number;
  bundle: number;
  dependency: number;
}

/** The bundle columns: two words, a digest and a dependency list per bundle. */
export interface BundleColumns {
  bundleWords: Uint32Array;
  bundleShaText: string;
  bundleDependencyCount: Uint32Array;
  bundleDependency: Uint32Array;
}

export interface GroupColumns {
  groupLevel: Int32Array;
  groupError: Float64Array;
  groupSphere: Float64Array;
  groupChildCount: Int32Array;
  groupOutputCount: Int32Array;
  groupChild: Int32Array;
  groupOutput: Int32Array;
  structureRoot: Int32Array;
}

/** The flat culling hierarchy of one primitive. Its stride is the format, so a foreign one is refused. */
export function decodeCulling(
  binary: SlimPrimitiveBinary,
  nodes: Float64Array,
  cursors: PartCursors,
): CullingHierarchy | null | undefined {
  if (binary.culling === undefined) return undefined;
  if (binary.culling === null) return null;
  const { stride, count } = binary.culling;
  if (stride !== 15)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      'Manifest binary culling stride differs from this version',
      { stride },
    );
  const decoded = {
    stride,
    count,
    nodes: Array.from(nodes.subarray(cursors.node * 15, (cursors.node + count) * 15)),
  };
  cursors.node += count;
  return decoded;
}

/** The group links of one primitive: which clusters a group replaces, and which it produces. */
export function decodeStructure(
  binary: SlimPrimitiveBinary,
  columns: GroupColumns,
  cursors: PartCursors,
): ClusterStructure | null | undefined {
  if (binary.structure === undefined) return undefined;
  if (binary.structure === null) return null;
  const groups: ClusterGroup[] = new Array(binary.structure.groups);
  for (let g = 0; g < binary.structure.groups; g++, cursors.group++) {
    const slot = cursors.group;
    const children = Array.from(
      columns.groupChild.subarray(cursors.child, cursors.child + columns.groupChildCount[slot]),
    );
    cursors.child += columns.groupChildCount[slot];
    const outputs = Array.from(
      columns.groupOutput.subarray(cursors.output, cursors.output + columns.groupOutputCount[slot]),
    );
    cursors.output += columns.groupOutputCount[slot];
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
    };
  }
  const roots = Array.from(
    columns.structureRoot.subarray(cursors.root, cursors.root + binary.structure.roots),
  );
  cursors.root += binary.structure.roots;
  return { version: binary.structure.version, roots, groups };
}

/** The streaming bundles of one primitive, each named by its own digest. */
export function decodeStreams(
  binary: SlimPrimitiveBinary,
  { bundleWords: words, bundleShaText: shaText, ...lists }: BundleColumns,
  url: { prefix: string; suffix: string },
  cursors: PartCursors,
): StreamCatalogue | null | undefined {
  if (binary.streams === undefined) return undefined;
  if (binary.streams === null) return null;
  const pages: StreamBundle[] = new Array(binary.streams.pages);
  for (let b = 0; b < binary.streams.pages; b++, cursors.bundle++) {
    const sha = shaText.substring(cursors.bundle * 64, cursors.bundle * 64 + 64);
    const count = lists.bundleDependencyCount[cursors.bundle];
    const dependencies = Array.from(
      lists.bundleDependency.subarray(cursors.dependency, (cursors.dependency += count)),
    );
    pages[b] = {
      url: url.prefix + sha + url.suffix,
      sha256: sha,
      bytes: words[cursors.bundle * 2],
      count: words[cursors.bundle * 2 + 1],
      dependencies,
    };
  }
  return {
    version: binary.streams.version,
    pinned: binary.streams.pinned,
    bundleBytes: binary.streams.bundleBytes,
    maxDependencies: binary.streams.maxDependencies,
    pages,
  };
}
