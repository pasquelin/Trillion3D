/**
 * THE RUNTIME CUTTER: drawn triangles cut into engine pages, off the main thread.
 *
 * What runs here touches no platform object — no URL, no DOM, no host library — so the page
 * worker runs it (`pageDecodeTask.ts`, op `cut`) and the main thread runs the same function when
 * no worker lives. The triangles travel as one buffer (`packDrawn`), and the pages come back as
 * bytes with their descriptors and digests: serving them at an address is the caller's.
 */
import { encodeGeometryPage } from '../../../page-codec/geometryPage.ts';
import type { PageAttributes } from '../../../page-codec/pageAttributes.ts';
import { sphereFromBounds } from '../../../sdk-core/mathSphere.ts';
import type { PageCutPage, PageCutPayload } from '../../../sdk-core/pageDecodeContracts.ts';
import type { DrawnTriangles } from '../../../sdk-core/world/geometry/drawn.ts';
import { sha256Hex } from '../../sha256Hex.ts';

/** A cluster holds at most this many triangles and vertices: the page format's cluster, the one
 *  the compiler cuts (`docs/FORMAT.md`). */
const CLUSTER_TRIANGLES = 128,
  CLUSTER_VERTICES = 255;

/** Drawn triangles as one buffer: five lengths, then the five arrays, every one four-byte wide. */
export function packDrawn(drawn: DrawnTriangles): ArrayBuffer {
  const parts = [drawn.positions, drawn.normals, drawn.uvs, drawn.colors, drawn.indices];
  const lengths = parts.map((part) => part?.length ?? 0);
  const packed = new Uint32Array(5 + lengths.reduce((a, b) => a + b, 0));
  packed.set(lengths);
  let at = 5;
  for (const part of parts)
    if (part) {
      packed.set(new Uint32Array(part.buffer, part.byteOffset, part.length), at);
      at += part.length;
    }
  return packed.buffer;
}

/** The triangles `packDrawn` wrote, as views on its buffer. */
export function unpackDrawn(buffer: ArrayBuffer): DrawnTriangles {
  const lengths = new Uint32Array(buffer, 0, 5);
  let at = 20;
  const take = <T>(make: (b: ArrayBuffer, offset: number, length: number) => T, i: number) => {
    const view = lengths[i] ? make(buffer, at, lengths[i]) : null;
    at += lengths[i] * 4;
    return view;
  };
  const float = (b: ArrayBuffer, offset: number, length: number) =>
    new Float32Array(b, offset, length);
  return {
    positions: take(float, 0)!,
    normals: take(float, 1)!,
    uvs: take(float, 2),
    colors: take(float, 3),
    indices: take((b, offset, length) => new Uint32Array(b, offset, length), 4)!,
  };
}

/**
 * Cuts drawn triangles into single-level clusters of the format's size, in index order, each
 * written as its index page and its quantized geometry page (`encodeGeometryPage`), with no
 * simplification — every cluster is a root, drawn as it is. The position grid is the one the
 * compiler takes from the primitive's own extent: 2^16 steps across its widest axis. The full
 * compiler with its DAG is #252.
 */
export async function cutDrawnTriangles(drawn: DrawnTriangles): Promise<PageCutPayload> {
  const { positions, normals, uvs, colors, indices } = drawn;
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    bounds[i % 3] = Math.min(bounds[i % 3], positions[i]);
    bounds[3 + (i % 3)] = Math.max(bounds[3 + (i % 3)], positions[i]);
  }
  const extent = Math.max(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]);
  const positionExponent = Math.ceil(Math.log2(extent > 0 ? extent : 1)) - 16;
  const attributes: PageAttributes = {
    POSITION: { itemSize: 3, array: positions },
    NORMAL: { itemSize: 3, array: normals },
    ...(uvs ? { TEXCOORD_0: { itemSize: 2, array: uvs } } : {}),
    ...(colors ? { COLOR_0: { itemSize: 4, array: colors } } : {}),
  };
  const pages: PageCutPage[] = [];
  let maxPositionError = 0;
  for (const [start, end] of clusters(indices)) {
    const corners = indices.slice(start, end);
    const page = encodeGeometryPage(corners, attributes, positionExponent);
    maxPositionError = Math.max(maxPositionError, page.quantizationError);
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const v of corners)
      for (let c = 0; c < 3; c++) {
        box[c] = Math.min(box[c], positions[v * 3 + c]);
        box[3 + c] = Math.max(box[3 + c], positions[v * 3 + c]);
      }
    const sphere = new Float64Array(4);
    sphereFromBounds(sphere, 0, box[0], box[1], box[2], box[3], box[4], box[5]);
    const index = corners.buffer,
      geometry = page.data.slice().buffer;
    pages.push({
      index,
      geometry,
      indexSha256: await sha256Hex(index),
      geometrySha256: await sha256Hex(geometry),
      count: corners.length,
      start,
      min: box.slice(0, 3),
      max: box.slice(3),
      sphere: Array.from(sphere),
      vertexCount: page.vertexCount,
      indexCount: page.indexCount,
      flags: page.flags,
      uncompressedBytes: page.uncompressedBytes,
    });
  }
  return { pages, positionExponent, maxPositionError };
}

/** Index ranges of consecutive triangles, each within the cluster's triangle and vertex bounds. */
function* clusters(indices: Uint32Array): Generator<[number, number]> {
  let start = 0;
  const seen = new Set<number>();
  for (let t = 0; t < indices.length; t += 3) {
    const fresh = [indices[t], indices[t + 1], indices[t + 2]].filter((v) => !seen.has(v));
    const full = (t - start) / 3 >= CLUSTER_TRIANGLES;
    if (full || seen.size + new Set(fresh).size > CLUSTER_VERTICES) {
      yield [start, t];
      start = t;
      seen.clear();
    }
    for (let k = 0; k < 3; k++) seen.add(indices[t + k]);
  }
  if (start < indices.length) yield [start, indices.length];
}
