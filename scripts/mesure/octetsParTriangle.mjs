// Bytes per triangle of a compiled cache, from its manifest alone: what the quantized cluster
// pages hold (resident bytes of a page reader), what their float decode occupies, the index
// pages, the vertices per triangle once shared corners are merged, and the grid the compiler
// chose with the largest displacement it caused. Read on `explorer.metadata` too, since it is
// the same manifest (guide "Quantized cluster pages").
//   node --experimental-strip-types scripts/mesure/octetsParTriangle.mjs <cache>/native/full
import { readCacheManifest } from './cacheManifest.mjs';

/** The cache's figures over the pages that carry geometry; `null` without any. */
export function bytesPerTriangle(manifest) {
  const sum = { pages: 0, triangles: 0, exact: 0, packed: 0, floats: 0, vertices: 0, index: 0 };
  let maxError = null,
    exponent = null;
  for (const primitive of manifest.primitives) {
    const q = primitive.quantization;
    if (q) {
      if (q.maxPositionError != null) maxError = Math.max(maxError ?? 0, q.maxPositionError);
      exponent = Math.max(exponent ?? -Infinity, q.positionExponent);
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
    positionStep: exponent == null ? null : 2 ** exponent,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const cache = process.argv[2];
  if (!cache) throw new Error('usage: octetsParTriangle.mjs <cache>/native/full');
  console.log(JSON.stringify(bytesPerTriangle(readCacheManifest(cache).manifest), null, 2));
}
