/**
 * THE RUNTIME CUTTER: drawn triangles cut into engine pages, off the main thread.
 *
 * What runs here touches no platform object — no URL, no DOM, no host library — but the SDK
 * module, which builds each cluster's normal cone (`cutCones.ts`); so the page worker runs it
 * (`page/decode/task.ts`, op `cut`) and the main thread runs the same function when no worker
 * lives. The triangles travel as one buffer (`packDrawn`), and the pages come back as
 * bytes with their descriptors and digests: serving them at an address is the caller's.
 */
import { encodeGeometryPage, UV_EXPONENT } from '../../../../page-codec/geometryPage.ts';
import { gridExponentFor } from '../../../../page-codec/pageGrids.ts';
import type { PageAttributes } from '../../../../page-codec/pageAttributes.ts';
import { boxEmpty, boxExpandByPoint } from '../../../../sdk-core/src/math/primitives/box.ts';
import { sphereFromBounds } from '../../../../sdk-core/src/math/primitives/sphere.ts';
import type { PageCutPage, PageCutPayload } from '../../../../sdk-core/src/page/decodeContracts.ts';
export { packDrawn, unpackDrawn } from './runtimePack.ts';
import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import { sha256Hex } from '../../measurement/sha256Hex.ts';
import { clusterCones } from './cutCones.ts';
import { clusters, givenClusters, primitiveUvSpan, widestUvSpan } from './cutClusters.ts';
import { positionGridExponent, textureGridExponent, type GridInputs } from './cutGrid.ts';

/**
 * A compiled primitive cut again in session (#846): its own clusters, `ends[k]` the end of cluster
 * `k` in the indices, each the corners of one of its pages in order, and what the compiler knew
 * of it beside its vertices (`GridInputs`), so its pages take the grids the compiler would give it.
 */
export type Recut = GridInputs & { ends: Uint32Array };

/**
 * Cuts drawn triangles into single-level clusters of the format's size, in index order, each
 * written as its index page and its quantized geometry page (`encodeGeometryPage`), with no
 * simplification — every cluster is a root, drawn as it is — and, when `cones` holds, with the
 * cone of its triangles' normals (`cutCones.ts`). Positions sit on the compiler's tiled grid
 * (`cutGrid.ts`). Texture coordinates sit on the format's 2^-14, or on the finest grid the widest
 * cluster's range fits when it does not — a dashed line's distance along it (`drawn.ts`) spans
 * past 1024 units on a long line: every page is cut, none refused, and each coordinate stays
 * within a 32-bit float's own step of that range. A `blended` primitive takes the finest grids
 * a page holds for both (2^23 steps), the compiler's rule too: a coarser one shows through a
 * transparent surface (#875). A `recut` keeps the compiled primitive's own clusters and takes the
 * grids the compiler gives its class — texture coordinates by their span over every vertex —, so
 * each page is the one the compiler writes for that class (#846).
 */
export async function cutDrawnTriangles(
  drawn: DrawnTriangles,
  cones: boolean,
  blended: boolean,
  recut?: Recut,
): Promise<PageCutPayload> {
  const { positions, normals, uvs, colors, indices } = drawn;
  const bounds = new Float64Array(6);
  boxEmpty(bounds, 0);
  for (let i = 0; i + 2 < positions.length; i += 3)
    boxExpandByPoint(bounds, 0, positions[i], positions[i + 1], positions[i + 2]);
  const extent = Math.max(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]);
  // Asked first, awaited last: the module loads while the clusters are cut.
  const grid = positionGridExponent(extent, blended, recut);
  const attributes: PageAttributes = {
    POSITION: { itemSize: 3, array: positions },
    ...(drawn.deformation?.joints && drawn.deformation.weights
      ? {
          JOINTS_0: { itemSize: 4, array: drawn.deformation.joints },
          WEIGHTS_0: { itemSize: 4, array: drawn.deformation.weights },
        }
      : {}),
    ...(normals.length ? { NORMAL: { itemSize: 3, array: normals } } : {}),
    ...(uvs ? { TEXCOORD_0: { itemSize: 2, array: uvs } } : {}),
    ...(colors ? { COLOR_0: { itemSize: 4, array: colors } } : {}),
  };
  const ranges = recut ? givenClusters(recut.ends) : [...clusters(indices, positions.length / 3)];
  const texture = (span: number) =>
    gridExponentFor(span, blended && span > 0 ? -Infinity : UV_EXPONENT);
  const uvExponent =
    (recut && uvs ? await textureGridExponent(primitiveUvSpan(uvs), blended) : null) ??
    texture(uvs ? widestUvSpan(uvs, indices, ranges) : 0);
  const built = cones ? await clusterCones(positions, indices, ranges) : null;
  const positionExponent = (await grid) ?? gridExponentFor(extent > 0 ? extent : 1, -Infinity);
  const cut = [];
  let maxPositionError = 0;
  for (const [start, end] of ranges) {
    const corners = indices.slice(start, end);
    const page = encodeGeometryPage(
      corners,
      attributes,
      positionExponent,
      uvExponent,
      drawn.deformation?.targets.map((target) => ({
        POSITION: { itemSize: 3, array: target.positions },
        NORMAL: { itemSize: 3, array: target.normals },
      })),
    );
    maxPositionError = Math.max(maxPositionError, page.quantizationError);
    const box = new Float64Array(6);
    boxEmpty(box, 0);
    for (const v of corners)
      boxExpandByPoint(box, 0, positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    const sphere = new Float64Array(4);
    sphereFromBounds(sphere, 0, box[0], box[1], box[2], box[3], box[4], box[5]);
    cut.push({ start, corners, page, box, sphere, geometry: page.data.slice().buffer });
  }
  const pages: PageCutPage[] = await Promise.all(
    cut.map(async ({ start, corners, page, box, sphere, geometry }, k) => ({
      index: corners.buffer,
      geometry,
      indexSha256: await sha256Hex(corners.buffer),
      geometrySha256: await sha256Hex(geometry),
      count: corners.length,
      start,
      min: Array.from(box.subarray(0, 3)),
      max: Array.from(box.subarray(3)),
      sphere: Array.from(sphere),
      vertexCount: page.vertexCount,
      indexCount: page.indexCount,
      flags: page.flags,
      uncompressedBytes: page.uncompressedBytes,
      ...(built ? { cone: built[k] } : {}),
    })),
  );
  return { pages, positionExponent, uvExponent, maxPositionError };
}
