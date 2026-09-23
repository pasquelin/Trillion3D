import type { EngineCamera } from './cameraWorld.ts';
import type { MatrixElements } from './matrixElements.ts';
import {
  clusterSphereValid,
  pageCarriesClusterError,
  type CullingHierarchy,
  type Page,
  type Primitive,
  type StreamCatalogue,
} from '../sdk-core/src/index.ts';
import {
  OPEN_CONE,
  coneContextFor,
  coneCullsPageWith,
  type ConeContext,
  type NormalCone,
} from './pageCone.ts';
import { surfaceFrontOnly, type PageSurface } from './pageSurface.ts';

/** The context is set at the root's first cone: a root without a cone never pays for it. */
export function coneSkipsPage(
  rec: {
    cone?: NormalCone;
    min?: number[];
    max?: number[];
    material?: PageSurface;
  },
  ctx: ConeContext,
  world: MatrixElements,
  cam: EngineCamera,
  fallbackMin: number[],
  fallbackMax: number[],
) {
  // The side is reread here, not taken off the record as it was last filled: `surfaceFrontOnly`
  // asks the declaration, and only a front-only surface can be cone-rejected at all.
  if (rec.material && !surfaceFrontOnly(rec.material)) return false;
  const min = rec.min ?? fallbackMin,
    max = rec.max ?? fallbackMax;
  if (!ctx.ready) coneContextFor(ctx, world, cam.viewPoint);
  return coneCullsPageWith(ctx, rec.cone ?? OPEN_CONE, world, min, max, rec.material);
}

/**
 * The largest distance the primitive's grid moved one of its source positions, in object units
 * (`primitives[].quantization.maxPositionError`), or zero on a cache whose pages carry no grid.
 * Every band and every box of the primitive grows by it: that is what makes the pixel threshold
 * bound the surface an engine actually draws, the quantized one.
 */
export function quantizationErrorOf(primitive: Pick<Primitive, 'quantization'>) {
  const error = primitive.quantization?.maxPositionError;
  return typeof error === 'number' && Number.isFinite(error) && error > 0 ? error : 0;
}

/** Validate and unpack the flat culling hierarchy. Absent or malformed, the flat path scans pages.
 *  `quantizationError` raises each node's subtree replacement bound by the same length it raises
 *  a cluster's band, so a subtree is never rejected on a band the clusters below no longer have. */
export function cullingNodes(
  culling: CullingHierarchy | null | undefined,
  pageCount: number,
  quantizationError = 0,
) {
  if (!culling || !Array.isArray(culling.nodes) || culling.stride < 15 || culling.count < 1)
    return undefined;
  if (culling.nodes.length !== culling.count * culling.stride)
    throw new Error('Inconsistent culling hierarchy');
  const nodes = Float64Array.from(culling.nodes);
  for (let node = 0; node < culling.count; node++) {
    const base = node * culling.stride,
      children = nodes[base + 12];
    // -1 says the subtree holds a cluster nothing replaces; a bound is raised, a sentinel is not.
    if (nodes[base + 10] >= 0) nodes[base + 10] += quantizationError;
    // A node encloses the boxes of its clusters, which the grid moved by the same length.
    for (let axis = 0; axis < 3; axis++) {
      nodes[base + axis] -= quantizationError;
      nodes[base + 3 + axis] += quantizationError;
    }
    if (children > 0) {
      if (nodes[base + 11] + children > culling.count)
        throw new Error('Inconsistent culling hierarchy');
      continue;
    }
    if (nodes[base + 13] + nodes[base + 14] > pageCount)
      throw new Error('Inconsistent culling hierarchy');
  }
  return { nodes, stride: culling.stride };
}

/** Only the fields a flat cut needs; a page without them keeps the hierarchy path.
 *  Always the same shape, so every page record stays one hidden class in the selection loop. */
const NO_CLUSTER_ERROR = {
  level: undefined,
  lodError: undefined,
  sphere: undefined,
  parentError: undefined,
  parentSphere: undefined,
  group: undefined,
  source: undefined,
} as const;
/**
 * The error band of a cluster, in object units, as the cut certifies it.
 *
 * `quantizationError` is the largest distance the primitive's grid moved one of its source
 * positions (`primitives[].quantization.maxPositionError`): the surface an engine draws from the
 * quantized pages stands that far from the surface the band was computed on, so the two distances
 * add — the screen threshold then bounds the drawn surface, not the source one. It is a sum of two
 * lengths in the same unit, nothing weighted.
 *
 * A cluster NO GROUP PRODUCED keeps its band as it is. Its band is the floor of the ladder — the
 * cache holds nothing finer of that surface —, and the threshold cannot ask for a refinement that
 * does not exist: at zero pixels, raising that floor would leave the cut with nothing to draw.
 * Every band the cut can still choose against grows: a produced cluster's own band, the band of
 * the group that replaces it, and the group bands themselves, so a replacement swaps at exactly
 * the same threshold as before and the cut stays a partition.
 */
export function clusterErrorFields(
  page: Page,
  quantizationError = 0,
): {
  level?: number;
  lodError?: number;
  sphere?: number[];
  parentError?: number | null;
  parentSphere?: number[] | null;
  group?: number | null;
  source?: number | null;
} {
  if (!pageCarriesClusterError(page)) return NO_CLUSTER_ERROR;
  const parent =
    typeof page.parentError === 'number' && Number.isFinite(page.parentError)
      ? page.parentError
      : null;
  if (parent !== null && !(Array.isArray(page.parentSphere) && page.parentSphere.length === 4))
    throw new Error(`Page ${page.id}: parentError without parentSphere`);
  if (parent !== null && parent < page.lodError!)
    throw new Error(`Page ${page.id}: parentError below lodError`);
  // The parent sphere uses the same rule as the page's own sphere: rejected here,
  // at prepare time, never mid-frame. A zero error projects nothing and does not read
  // its sphere; it has nothing to validate.
  if (parent !== null && parent + quantizationError > 0 && !clusterSphereValid(page.parentSphere))
    throw new Error('Invalid cluster parameters');
  const source = typeof page.source === 'number' ? page.source : null;
  return {
    level: page.level,
    lodError: page.lodError! + (source === null ? 0 : quantizationError),
    sphere: page.sphere,
    parentError: parent === null ? null : parent + quantizationError,
    parentSphere: parent === null ? null : page.parentSphere,
    group: typeof page.group === 'number' ? page.group : null,
    source,
  };
}
/** Bundle URL and offset of every page, or undefined when the cache predates streaming bundles. */
export function streamPlacement(
  streams: StreamCatalogue | null | undefined,
  pages: readonly Page[],
) {
  if (!streams || !Array.isArray(streams.pages) || !streams.pages.length) return undefined;
  const placement = pages.map((page) => {
    if (typeof page.stream !== 'number' || typeof page.streamOffset !== 'number') return undefined;
    const bundle = streams.pages[page.stream];
    if (!bundle) throw new Error(`Page ${page.id} outside streaming bundles`);
    if (page.streamOffset + page.count * 4 > bundle.bytes)
      throw new Error(`Page ${page.id} exceeds its bundle`);
    return { url: bundle.url, offset: page.streamOffset };
  });
  return placement.every((entry) => entry)
    ? (placement as Array<{ url: string; offset: number }>)
    : undefined;
}

/** Meshes of a resolved host graph. One traversal in the package, that of
 *  `sceneMeshes.ts`: selection used to read the same one, word for word. */
export { meshes as objects } from './sceneMeshes.ts';
