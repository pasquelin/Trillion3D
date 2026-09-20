import type { EngineCamera } from './cameraWorld.ts';
import type { MatrixElements } from './matrixElements.ts';
import {
  clusterSphereValid,
  pageCarriesClusterError,
  type CullingHierarchy,
  type Page,
  type ClusterStructure,
  type StreamCatalogue,
} from '../sdk-core/index.ts';
import type * as THREE from 'three';
import { sideOf } from './materialSide.ts';
import {
  OPEN_CONE,
  coneContextFor,
  coneCullsPageWith,
  type ConeContext,
  type NormalCone,
} from './pageCone.ts';
import type { ClusterStructureIndex } from './pageSelectionTypes.ts';

function pageIsDoubleSided(material: THREE.Material | THREE.Material[] | undefined) {
  return !!material && sideOf(material) === 'double';
}

/** The context is set at the root's first cone: a root without a cone never pays for it. */
export function coneSkipsPage(
  rec: {
    cone?: NormalCone;
    min?: number[];
    max?: number[];
    material?: THREE.Material | THREE.Material[];
  },
  ctx: ConeContext,
  world: MatrixElements,
  cam: EngineCamera,
  fallbackMin: number[],
  fallbackMax: number[],
) {
  if (pageIsDoubleSided(rec.material)) return false;
  const min = rec.min ?? fallbackMin,
    max = rec.max ?? fallbackMax;
  if (!ctx.ready) coneContextFor(ctx, world, cam.eye);
  return coneCullsPageWith(ctx, rec.cone ?? OPEN_CONE, world, min, max, rec.material);
}

/** Validate and unpack the flat culling hierarchy. Absent or malformed, the flat path scans pages. */
export function cullingNodes(culling: CullingHierarchy | null | undefined, pageCount: number) {
  if (!culling || !Array.isArray(culling.nodes) || culling.stride < 15 || culling.count < 1)
    return undefined;
  if (culling.nodes.length !== culling.count * culling.stride)
    throw new Error('Inconsistent culling hierarchy');
  const nodes = Float64Array.from(culling.nodes);
  for (let node = 0; node < culling.count; node++) {
    const base = node * culling.stride,
      children = nodes[base + 12];
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
export function clusterErrorFields(page: Page): {
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
  if (parent !== null && parent > 0 && !clusterSphereValid(page.parentSphere))
    throw new Error('Invalid cluster parameters');
  return {
    level: page.level,
    lodError: page.lodError,
    sphere: page.sphere,
    parentError: parent,
    parentSphere: parent === null ? null : page.parentSphere,
    group: typeof page.group === 'number' ? page.group : null,
    source: typeof page.source === 'number' ? page.source : null,
  };
}
export function structureIndex(
  structure: ClusterStructure | null | undefined,
  pageCount: number,
): ClusterStructureIndex | undefined {
  if (!structure || !Array.isArray(structure.groups) || !Array.isArray(structure.roots))
    return undefined;
  const groupCount = structure.groups.length;
  if (!groupCount) return undefined;
  const childOffsets = new Int32Array(groupCount + 1),
    outputOffsets = new Int32Array(groupCount + 1);
  for (let g = 0; g < groupCount; g++) {
    childOffsets[g + 1] = childOffsets[g] + structure.groups[g].children.length;
    outputOffsets[g + 1] = outputOffsets[g] + structure.groups[g].outputs.length;
  }
  const children = new Int32Array(childOffsets[groupCount]),
    outputs = new Int32Array(outputOffsets[groupCount]);
  const sources = new Int32Array(pageCount).fill(-1),
    owners = new Int32Array(pageCount).fill(-1);
  const error = new Float64Array(groupCount),
    sphere = new Float64Array(groupCount * 4);
  for (let g = 0; g < groupCount; g++) {
    const group = structure.groups[g];
    if (!(group.error >= 0) || !Array.isArray(group.sphere) || group.sphere.length !== 4)
      throw new Error(`Group ${g} without error or bounds`);
    error[g] = group.error;
    for (let a = 0; a < 4; a++) sphere[g * 4 + a] = group.sphere[a];
    let at = childOffsets[g];
    for (const child of group.children) {
      if (!(child >= 0 && child < pageCount))
        throw new Error(`Group ${g} references an unknown page`);
      if (owners[child] >= 0) throw new Error(`Page ${child} belongs to two groups`);
      owners[child] = g;
      children[at++] = child;
    }
    at = outputOffsets[g];
    for (const output of group.outputs) {
      if (!(output >= 0 && output < pageCount))
        throw new Error(`Group ${g} references an unknown page`);
      if (sources[output] >= 0) throw new Error(`Page ${output} is produced by two groups`);
      sources[output] = g;
      outputs[at++] = output;
    }
  }
  for (const root of structure.roots)
    if (!(root >= 0 && root < pageCount && owners[root] < 0))
      throw new Error('Invalid structure root');
  return {
    groupCount,
    childOffsets,
    children,
    outputOffsets,
    outputs,
    sources,
    owners,
    error,
    sphere,
    roots: structure.roots,
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
