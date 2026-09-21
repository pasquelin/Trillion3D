import { EngineError, type ClusterManifest } from './contracts.ts';
import { MAX_DEPTH_LAYER } from './depthLayer.ts';
import * as format from './manifestBinaryFormat.ts';
import {
  countManifest,
  expectTemplate,
  manifestBinaryRanges,
  writeSha,
} from './manifestBinaryLayout.ts';
import { encodePreviewColumns } from './manifestBinaryPreviewEncode.ts';
import { slimBinaryOf } from './manifestBinaryTypes.ts';
import type {
  ManifestBinaryDescriptor,
  SlimClusterManifest,
  SlimPrimitive,
} from './manifestBinaryTypes.ts';

/** Splits a manifest into the small JSON a reader parses and the columns it maps. The returned
 *  descriptor carries an empty `sha256`: only the caller, holding the finished bytes, can hash them. */
export function encodeManifestBinary(
  manifest: ClusterManifest,
  descriptor: Pick<ManifestBinaryDescriptor, 'url' | 'pageUrl' | 'geometryUrl' | 'bundleUrl'>,
): { manifest: SlimClusterManifest; binary: Uint8Array } {
  const counts = countManifest(manifest);
  const { ranges, bytes } = manifestBinaryRanges(counts);
  const buffer = new ArrayBuffer(bytes);
  const header = new Uint32Array(
    buffer,
    0,
    format.MANIFEST_BINARY_HEADER_WORDS + format.COLUMN_NAMES.length * 2,
  );
  header[0] = format.MANIFEST_BINARY_MAGIC;
  header[1] = format.MANIFEST_BINARY_VERSION;
  header[2] = format.COLUMN_NAMES.length;
  header[3] = 0;
  format.COLUMN_NAMES.forEach((name, index) => {
    header[format.MANIFEST_BINARY_HEADER_WORDS + index * 2] = ranges[name].offset;
    header[format.MANIFEST_BINARY_HEADER_WORDS + index * 2 + 1] = ranges[name].length;
  });
  const view = <T>(name: format.ColumnName, make: (b: ArrayBuffer, o: number, n: number) => T): T =>
    make(
      buffer,
      ranges[name].offset,
      ranges[name].length / format.BYTES_PER_ELEMENT[format.COLUMN_KIND[name]],
    );
  const bounds = view('pageBounds', (b, o, n) => new Float64Array(b, o, n)),
    sphere = view('pageSphere', (b, o, n) => new Float64Array(b, o, n));
  const parentSphere = view('pageParentSphere', (b, o, n) => new Float64Array(b, o, n)),
    error = view('pageError', (b, o, n) => new Float64Array(b, o, n));
  const ints = view('pageInt', (b, o, n) => new Int32Array(b, o, n)),
    words = view('pageU32', (b, o, n) => new Uint32Array(b, o, n));
  const pageSha = view('pageSha', (b, o, n) => new Uint8Array(b, o, n)),
    geometrySha = view('geometrySha', (b, o, n) => new Uint8Array(b, o, n));
  const geometryWords = view('geometryU32', (b, o, n) => new Uint32Array(b, o, n));
  const cullingNodes = view('cullingNodes', (b, o, n) => new Float64Array(b, o, n));
  const groupLevel = view('groupLevel', (b, o, n) => new Int32Array(b, o, n)),
    groupError = view('groupError', (b, o, n) => new Float64Array(b, o, n));
  const groupSphere = view('groupSphere', (b, o, n) => new Float64Array(b, o, n));
  const groupChildCount = view('groupChildCount', (b, o, n) => new Int32Array(b, o, n)),
    groupChild = view('groupChild', (b, o, n) => new Int32Array(b, o, n));
  const groupOutputCount = view('groupOutputCount', (b, o, n) => new Int32Array(b, o, n)),
    groupOutput = view('groupOutput', (b, o, n) => new Int32Array(b, o, n));
  const structureRoot = view('structureRoot', (b, o, n) => new Int32Array(b, o, n));
  const bundleWords = view('bundleU32', (b, o, n) => new Uint32Array(b, o, n)),
    bundleSha = view('bundleSha', (b, o, n) => new Uint8Array(b, o, n));
  const pageDepthLayer = view('pageDepthLayer', (b, o, n) => new Uint32Array(b, o, n));
  encodePreviewColumns(manifest.texturePreviews ?? [], view);
  let page = 0,
    node = 0,
    group = 0,
    child = 0,
    output = 0,
    root = 0,
    bundle = 0;
  const primitives: SlimPrimitive[] = manifest.primitives.map((primitive) => {
    for (const item of primitive.pages) {
      bounds.set(item.min, page * 6);
      bounds.set(item.max, page * 6 + 3);
      let flags = 0;
      if (item.role !== undefined) {
        flags |= format.FLAG_ROLE;
        if (item.role === 'coarse') flags |= format.FLAG_COARSE;
      }
      if (typeof item.lodError === 'number' && Array.isArray(item.sphere)) {
        flags |= format.FLAG_CLUSTER_ERROR;
        error[page * 2] = item.lodError;
        sphere.set(item.sphere, page * 4);
      }
      if (item.parentError !== undefined) {
        flags |= format.FLAG_PARENT_ERROR;
        if (typeof item.parentError === 'number') {
          flags |= format.FLAG_PARENT_ERROR_FINITE;
          error[page * 2 + 1] = item.parentError;
        }
      }
      if (item.parentSphere !== undefined) {
        flags |= format.FLAG_PARENT_SPHERE;
        if (item.parentSphere !== null) {
          flags |= format.FLAG_PARENT_SPHERE_SET;
          parentSphere.set(item.parentSphere, page * 4);
        }
      }
      ints[page * 8 + format.INT_ID] = item.id;
      ints[page * 8 + format.INT_LEVEL] = item.level ?? -1;
      if (item.group !== undefined) {
        flags |= format.FLAG_GROUP;
        ints[page * 8 + format.INT_GROUP] = item.group ?? -1;
      } else ints[page * 8 + format.INT_GROUP] = -1;
      if (item.source !== undefined) {
        flags |= format.FLAG_SOURCE;
        ints[page * 8 + format.INT_SOURCE] = item.source ?? -1;
      } else ints[page * 8 + format.INT_SOURCE] = -1;
      ints[page * 8 + format.INT_STREAM] = item.stream ?? -1;
      ints[page * 8 + format.INT_STREAM_OFFSET] = item.streamOffset ?? -1;
      ints[page * 8 + format.INT_COUNT] = item.count;
      ints[page * 8 + format.INT_START] = item.start ?? -1;
      words[page * 2 + format.U32_BYTES] = item.bytes;
      expectTemplate(descriptor.pageUrl, item.url, item.sha256);
      writeSha(pageSha, page, item.sha256);
      if (item.geometry) {
        flags |= format.FLAG_GEOMETRY;
        expectTemplate(descriptor.geometryUrl, item.geometry.url, item.geometry.sha256);
        writeSha(geometrySha, page, item.geometry.sha256);
        geometryWords[page * 5] = item.geometry.bytes;
        geometryWords[page * 5 + 1] = item.geometry.vertexCount;
        geometryWords[page * 5 + 2] = item.geometry.indexCount;
        geometryWords[page * 5 + 3] = item.geometry.flags;
        geometryWords[page * 5 + 4] = item.geometry.uncompressedBytes;
      }
      words[page * 2 + format.U32_FLAGS] = flags;
      if (item.depthLayer !== undefined) {
        if (
          !Number.isInteger(item.depthLayer) ||
          item.depthLayer < 0 ||
          item.depthLayer > MAX_DEPTH_LAYER
        )
          throw new EngineError('INVALID_CACHE', 'A cluster depth layer does not fit four bits', {
            depthLayer: item.depthLayer,
          });
        pageDepthLayer[page] = item.depthLayer;
      }
      page++;
    }
    if (primitive.culling) {
      cullingNodes.set(primitive.culling.nodes, node * 15);
      node += primitive.culling.count;
    }
    for (const item of primitive.structure?.groups ?? []) {
      groupLevel[group] = item.level;
      groupError[group] = item.error;
      groupSphere.set(item.sphere, group * 4);
      groupChildCount[group] = item.children.length;
      groupChild.set(item.children, child);
      child += item.children.length;
      groupOutputCount[group] = item.outputs.length;
      groupOutput.set(item.outputs, output);
      output += item.outputs.length;
      group++;
    }
    if (primitive.structure) {
      structureRoot.set(primitive.structure.roots, root);
      root += primitive.structure.roots.length;
    }
    for (const item of primitive.streams?.pages ?? []) {
      expectTemplate(descriptor.bundleUrl, item.url, item.sha256);
      writeSha(bundleSha, bundle, item.sha256);
      bundleWords[bundle * 2] = item.bytes;
      bundleWords[bundle * 2 + 1] = item.count;
      bundle++;
    }
    const {
      pages: _pages,
      culling: _culling,
      structure: _structure,
      streams: _streams,
      ...rest
    } = primitive;
    const slim = slimBinaryOf(primitive);
    return { ...rest, binary: slim } as SlimPrimitive;
  });
  const { primitives: _ignored, ...top } = manifest;
  return {
    manifest: {
      ...top,
      binary: {
        ...descriptor,
        version: format.MANIFEST_BINARY_VERSION,
        sha256: '',
        bytes,
        texturePreviews: counts.previews,
        texturePreviewBytes: counts.previewBytes,
        texturePreviewBc7Bytes: counts.previewBlockBytes.bc7,
        texturePreviewAstcBytes: counts.previewBlockBytes.astc,
      },
      primitives,
    } as SlimClusterManifest,
    binary: new Uint8Array(buffer),
  };
}
