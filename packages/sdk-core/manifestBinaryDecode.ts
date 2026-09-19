import {
  type ClusterManifest,
  type GeometryPageDescriptor,
  type Page,
  type Primitive,
} from './contracts.ts';
import { decodeCulling, decodeStreams, decodeStructure } from './manifestBinaryDecodeParts.ts';
import { decodeTexturePreviews } from './manifestBinaryPreview.ts';
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
      pageDepthLayer,
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
    previews,
    cullingNodes,
    urls: { pagePrefix, pageSuffix, geometryPrefix, geometrySuffix, bundlePrefix, bundleSuffix },
  } = readManifestColumns(slim, buffer);
  const groupColumns = {
    groupLevel,
    groupError,
    groupSphere,
    groupChildCount,
    groupOutputCount,
    groupChild,
    groupOutput,
    structureRoot,
  };
  const cursors = { node: 0, group: 0, child: 0, output: 0, root: 0, bundle: 0 };
  let page = 0;
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
      // Layer 0 is the untouched draw; leaving the field out keeps one shape for every page record.
      if (pageDepthLayer[page] > 0) item.depthLayer = pageDepthLayer[page];
      pages[i] = item;
    }
    const culling = decodeCulling(binary, cullingNodes, cursors);
    const structure = decodeStructure(binary, groupColumns, cursors);
    const streams = decodeStreams(
      binary,
      bundleWords,
      bundleShaText,
      { prefix: bundlePrefix, suffix: bundleSuffix },
      cursors,
    );
    const { binary: _ignored, ...rest } = entry;
    const result = { ...rest, pages } as Primitive;
    if (culling !== undefined) result.culling = culling;
    if (structure !== undefined) result.structure = structure;
    if (streams !== undefined) result.streams = streams;
    return result;
  });
  const { binary: _descriptor, primitives: _slimPrimitives, ...top } = slim;
  return {
    ...top,
    primitives,
    texturePreviews: decodeTexturePreviews(previews),
  } as ClusterManifest;
}

/** Les vignettes seules, sans matérialiser les pages : ce qu'une revue d'images a besoin de lire. */
export function decodeManifestPreviews(slim: SlimClusterManifest, buffer: ArrayBuffer) {
  return decodeTexturePreviews(readManifestColumns(slim, buffer).previews);
}
