import {
  EngineError,
  type ClusterManifest,
  type ClusterGroup,
  type ClusterStructure,
  type CullingHierarchy,
  type GeometryPageDescriptor,
  type Page,
  type Primitive,
  type StreamBundle,
  type StreamCatalogue,
} from './contracts.ts';
import * as format from './manifestBinaryFormat.ts';
import { readManifestColumns } from './manifestBinaryRead.ts';
import type { SlimClusterManifest } from './manifestBinaryTypes.ts';
export function decodeManifestBinary(
  slim: SlimClusterManifest,
  buffer: ArrayBuffer,
): ClusterManifest {
  const {
    pages: {
      bounds,
      sphere,
      parentSphere,
      error,
      ints,
      words,
      geometryWords,
      pageShaText,
      geometryShaText,
    },
    groups: {
      groupLevel,
      groupError,
      groupSphere,
      groupChildCount,
      groupOutputCount,
      groupChild,
      groupOutput,
      structureRoot,
    },
    bundles: { bundleWords, bundleShaText },
    cullingNodes,
    urls: { pagePrefix, pageSuffix, geometryPrefix, geometrySuffix, bundlePrefix, bundleSuffix },
  } = readManifestColumns(slim, buffer);
  let page = 0,
    node = 0,
    group = 0,
    child = 0,
    output = 0,
    root = 0,
    bundle = 0;
  const primitives: Primitive[] = slim.primitives.map((entry) => {
    const binary = entry.binary;
    const pages: Page[] = new Array(binary.pages);
    for (let i = 0; i < binary.pages; i++, page++) {
      const flags = words[page * 2 + format.U32_FLAGS],
        base = page * 8;
      const sha = pageShaText.substring(page * 64, page * 64 + 64);
      const item: Page = {
        id: ints[base + format.INT_ID],
        url: pagePrefix + sha + pageSuffix,
        sha256: sha,
        bytes: words[page * 2 + format.U32_BYTES],
        count: ints[base + format.INT_COUNT],
        min: [bounds[page * 6], bounds[page * 6 + 1], bounds[page * 6 + 2]],
        max: [bounds[page * 6 + 3], bounds[page * 6 + 4], bounds[page * 6 + 5]],
      };
      if (flags & format.FLAG_ROLE) item.role = flags & format.FLAG_COARSE ? 'coarse' : 'exact';
      if (flags & format.FLAG_GEOMETRY) {
        const geometrySha = geometryShaText.substring(page * 64, page * 64 + 64);
        item.geometry = {
          url: geometryPrefix + geometrySha + geometrySuffix,
          sha256: geometrySha,
          bytes: geometryWords[page * 5],
          formatVersion: 2,
          codec: 'meshopt',
          vertexCount: geometryWords[page * 5 + 1],
          indexCount: geometryWords[page * 5 + 2],
          flags: geometryWords[page * 5 + 3],
          uncompressedBytes: geometryWords[page * 5 + 4],
        } as GeometryPageDescriptor;
      }
      if (ints[base + format.INT_START] >= 0) item.start = ints[base + format.INT_START];
      if (ints[base + format.INT_LEVEL] >= 0) item.level = ints[base + format.INT_LEVEL];
      if (flags & format.FLAG_CLUSTER_ERROR) {
        item.lodError = error[page * 2];
        item.sphere = [
          sphere[page * 4],
          sphere[page * 4 + 1],
          sphere[page * 4 + 2],
          sphere[page * 4 + 3],
        ];
      }
      if (flags & format.FLAG_PARENT_ERROR)
        item.parentError = flags & format.FLAG_PARENT_ERROR_FINITE ? error[page * 2 + 1] : null;
      if (flags & format.FLAG_PARENT_SPHERE)
        item.parentSphere =
          flags & format.FLAG_PARENT_SPHERE_SET
            ? [
                parentSphere[page * 4],
                parentSphere[page * 4 + 1],
                parentSphere[page * 4 + 2],
                parentSphere[page * 4 + 3],
              ]
            : null;
      if (flags & format.FLAG_GROUP)
        item.group = ints[base + format.INT_GROUP] >= 0 ? ints[base + format.INT_GROUP] : null;
      if (flags & format.FLAG_SOURCE)
        item.source = ints[base + format.INT_SOURCE] >= 0 ? ints[base + format.INT_SOURCE] : null;
      if (ints[base + format.INT_STREAM] >= 0) {
        item.stream = ints[base + format.INT_STREAM];
        item.streamOffset = ints[base + format.INT_STREAM_OFFSET];
      }
      pages[i] = item;
    }
    let culling: CullingHierarchy | null | undefined;
    if (binary.culling !== undefined) {
      if (binary.culling === null) culling = null;
      else {
        const { stride, count } = binary.culling;
        if (stride !== 15)
          throw new EngineError(
            'UNSUPPORTED_FORMAT',
            'Manifest binary culling stride differs from this version',
            { stride },
          );
        culling = {
          stride,
          count,
          nodes: Array.from(cullingNodes.subarray(node * 15, (node + count) * 15)),
        };
        node += count;
      }
    }
    let structure: ClusterStructure | null | undefined;
    if (binary.structure !== undefined) {
      if (binary.structure === null) structure = null;
      else {
        const groups: ClusterGroup[] = new Array(binary.structure.groups);
        for (let g = 0; g < binary.structure.groups; g++, group++) {
          const children = Array.from(groupChild.subarray(child, child + groupChildCount[group]));
          child += groupChildCount[group];
          const outputs = Array.from(
            groupOutput.subarray(output, output + groupOutputCount[group]),
          );
          output += groupOutputCount[group];
          groups[g] = {
            level: groupLevel[group],
            error: groupError[group],
            sphere: [
              groupSphere[group * 4],
              groupSphere[group * 4 + 1],
              groupSphere[group * 4 + 2],
              groupSphere[group * 4 + 3],
            ],
            children,
            outputs,
          };
        }
        structure = {
          version: binary.structure.version,
          roots: Array.from(structureRoot.subarray(root, root + binary.structure.roots)),
          groups,
        };
        root += binary.structure.roots;
      }
    }
    let streams: StreamCatalogue | null | undefined;
    if (binary.streams !== undefined) {
      if (binary.streams === null) streams = null;
      else {
        const list: StreamBundle[] = new Array(binary.streams.pages);
        for (let b = 0; b < binary.streams.pages; b++, bundle++) {
          const sha = bundleShaText.substring(bundle * 64, bundle * 64 + 64);
          list[b] = {
            url: bundlePrefix + sha + bundleSuffix,
            sha256: sha,
            bytes: bundleWords[bundle * 2],
            count: bundleWords[bundle * 2 + 1],
          };
        }
        streams = {
          version: binary.streams.version,
          pinned: binary.streams.pinned,
          bundleBytes: binary.streams.bundleBytes,
          pages: list,
        };
      }
    }
    const { binary: _ignored, ...rest } = entry;
    const result = { ...rest, pages } as Primitive;
    if (culling !== undefined) result.culling = culling;
    if (structure !== undefined) result.structure = structure;
    if (streams !== undefined) result.streams = streams;
    return result;
  });
  const { binary: _descriptor, primitives: _slimPrimitives, ...top } = slim;
  return { ...top, primitives } as ClusterManifest;
}
