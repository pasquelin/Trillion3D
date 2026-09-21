// Bytes per triangle of a compiled cache, from its manifest alone: what the quantized cluster
// pages hold (resident bytes of a page reader), what their float decode occupies, the index
// pages, the vertices per triangle once shared corners are merged, and the grid the compiler
// chose with the largest displacement it caused. Read on `explorer.metadata` too, since it is
// the same manifest (guide "Quantized cluster pages").
//   node --experimental-strip-types scripts/mesure/octetsParTriangle.mjs <cache>/native/full
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { decodeManifestBinary } from '../../packages/sdk-core/manifestBinary.ts';

/** The manifest of a compiled cache — pointer, small JSON, sidecar columns — decoded whole. */
async function readCacheManifest(cache) {
  const pointer = JSON.parse(await readFile(join(cache, 'manifest.json'), 'utf8'));
  const clustersPath = join(cache, pointer.url);
  const slim = JSON.parse(await readFile(clustersPath, 'utf8'));
  const bin = await readFile(join(dirname(clustersPath), slim.binary.url));
  return decodeManifestBinary(
    slim,
    bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
  );
}

/** The cache's figures over the pages that carry geometry; `null` without any. */
export function bytesPerTriangle(manifest) {
  const sum = { pages: 0, triangles: 0, exact: 0, packed: 0, floats: 0, vertices: 0, index: 0 };
  let maxError = null,
    step = null;
  for (const primitive of manifest.primitives) {
    const q = primitive.quantization;
    if (q && primitive.pages.length) {
      if (q.maxPositionError != null) maxError = Math.max(maxError ?? 0, q.maxPositionError);
      step = step == null ? q.positionStep : Math.max(step, q.positionStep);
    }
    for (const page of primitive.pages) {
      if (!page.geometry) continue;
      sum.pages++;
      sum.triangles += page.count / 3;
      if (page.level === 0) sum.exact += page.count / 3;
      sum.packed += page.geometry.bytes;
      sum.floats += page.geometry.uncompressedBytes;
      sum.vertices += page.geometry.vertexCount;
      sum.index += page.bytes;
    }
  }
  if (!sum.triangles) return null;
  return {
    key: manifest.key,
    compilerVersion: manifest.compilerVersion ?? null,
    primitives: manifest.primitives.length,
    pages: sum.pages,
    triangles: sum.triangles,
    exactTriangles: sum.exact,
    packedBytesPerTriangle: sum.packed / sum.triangles,
    floatBytesPerTriangle: sum.floats / sum.triangles,
    indexPageBytesPerTriangle: sum.index / sum.triangles,
    verticesPerTriangle: sum.vertices / sum.triangles,
    maxPositionError: maxError,
    positionStep: step,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const cache = process.argv[2];
  if (!cache) throw new Error('usage: octetsParTriangle.mjs <cache>/native/full');
  console.log(JSON.stringify(bytesPerTriangle(await readCacheManifest(cache)), null, 2));
}
