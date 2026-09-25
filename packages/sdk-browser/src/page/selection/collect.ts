import { BOX_VALUES, boxTransform, type ClusterManifest } from '../../../../sdk-core/src/index.ts';
import { meshSurface } from '../surface.ts';
import { neverCulled } from '../../visibility/shader/spriteWgsl.ts';
import type { BlendCopy } from '../../cluster/blendCopyContract.ts';
import { createBlendCopyRecord } from '../../cluster/blendCopyRecord.ts';
import { objects, quantizationErrorOf } from './helpers.ts';
import { primitiveFinder } from '../../scene/primitiveLookup.ts';
import { createPrimitiveTemplates } from './template.ts';
import { indexPageRequests } from './requests.ts';
import { linkBundleDependencies } from './bundleDependencies.ts';
import { hostWorldPlacements } from '../../host/world/placements.ts';
import type { PageRec, ClusterRoot } from './types.ts';
import { placementsOf } from '../../placement/roots.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

export function collectClusterPages(
  source: Object3D,
  metadata: ClusterManifest,
  indices: Map<string, Uint32Array>,
  associations: Map<Object3D, { meshes?: number; primitives?: number; placements?: PlacementRows }>,
  options: { allowMissing?: boolean; blendCopy?: typeof createBlendCopyRecord } = {},
) {
  // World matrices of pages and roots are the ENGINE's, computed from the host's local poses:
  // no record any longer carries the live `matrixWorld` of its mesh.
  const worlds = hostWorldPlacements(source);
  const roots: Array<ClusterRoot<PageRec>> = [],
    allPages: PageRec[] = [],
    blendCopies: BlendCopy[] = [],
    bootstrap: PageRec[] = [];
  const primitiveOf = primitiveFinder(metadata.primitives);
  // A transparent surface leaves the collection as the engine's own record. A WebGL2 engine that
  // draws its display graph whole hands in a builder of graph meshes instead
  // (`../../cluster/blendCopyMesh.ts`).
  const blendCopy = options.blendCopy ?? createBlendCopyRecord;
  // One template per source object, shared by all its placements: the DAG shape, its error
  // bands and cluster identities depend on no world matrix.
  const templates = createPrimitiveTemplates(indices, options.allowMissing === true);
  let order = 0;
  for (const mesh of objects(source)) {
    const primitive = primitiveOf(associations.get(mesh));
    if (!primitive) throw new Error(`Missing primitive association: ${mesh.name}`);
    // One root per placement: the node's own pose, or each row of the instance buffer the
    // association carries (`placementRoots`), each row's world a view on that buffer.
    const placed = placementsOf(associations.get(mesh), () => worlds.of(mesh));
    // The surface the declaration wears, read at the boundary into the engine's own record:
    // from here on this collection and everything it feeds hold records, not host materials.
    const surface = meshSurface(mesh);
    // One blended draw per placement, sharing the mesh's geometry and surface: each is ordered by
    // its own depth, and a row's copy is skipped while the row is parked.
    if (primitive.pass === 'shared-blend' || surface.transmission > 0) {
      for (const { world, placement } of placed)
        blendCopies.push(blendCopy(mesh, order, world, surface, placement));
      order++;
      continue;
    }
    const template = templates.pagesOf(primitive);
    const transparent = primitive.pass === 'clustered-blend' || surface.transparent;
    // The grid moved every position of this primitive by at most this much: its clusters' boxes
    // grow by it, so culling still encloses the surface an engine draws from the pages.
    const slack = quantizationErrorOf(primitive);
    const widen = (bounds: number[], sign: number) =>
      slack > 0 ? bounds.map((value) => value + sign * slack) : bounds;
    // The widened boxes depend on no placement: every placement's records share them.
    const mins = primitive.pages.map((page) => widen(page.min, -1)),
      maxs = primitive.pages.map((page) => widen(page.max, 1));
    // A flat cut has no tree; transparent pages recover their draw order from the recorded source rank.
    const sourceOrder = transparent ? template.sourceOrder : undefined;
    const shape = templates.shapeOf(primitive, template);
    const { structure, culling } = shape;
    for (const { world, parked, placement } of placed) {
      const pages = primitive.pages.map((page, pageIndex) => {
        const entry = template.pages[pageIndex],
          cut = entry.cut,
          streamed = entry.placed;
        const rec: PageRec = {
          id: page.id,
          url: page.url,
          clusterId: entry.clusterId,
          array: entry.array,
          triangles: page.count / 3,
          indexBytes: entry.array?.byteLength ?? page.bytes,
          // A transparent cluster keeps its index page: its forward draw reads an index buffer and
          // the source vertices, which no page replaces (`../../webgpu/blend/shader.ts`).
          geometryPage: transparent ? undefined : page.geometry,
          min: mins[pageIndex],
          max: maxs[pageIndex],
          role: page.role,
          level: cut.level,
          lodError: cut.lodError,
          sphere: cut.sphere,
          parentError: cut.parentError,
          parentSphere: cut.parentSphere,
          group: cut.group,
          source: cut.source,
          streamUrl: streamed?.url,
          streamOffset: streamed?.offset,
          depthLayer: page.depthLayer ?? 0,
          attributes: mesh.geometry.attributes,
          material: surface,
          declaration: mesh.material,
          transparent,
          sourceMesh: mesh,
          sourceOrder: sourceOrder?.[pageIndex] ?? pageIndex,
          matrix: world,
          placement,
          renderOrder: order,
          attached: false,
          cone: undefined,
          geometry: undefined,
          mesh: undefined,
          resident: false,
        };
        allPages.push(rec);
        return rec;
      });
      linkBundleDependencies(primitive, pages);
      const worldBox = new Float64Array(BOX_VALUES);
      boxTransform(worldBox, 0, shape.local, 0, world.elements);
      roots.push({
        world,
        pages,
        // Nodes, their bounds and their links belong to the primitive and are shared by all its
        // placements.
        culling: culling && { ...culling, bounds: shape.bounds!, links: shape.links },
        worldBox,
        localBox: shape.local.slice(),
        structure,
        // No collected page carries a cone: `prepareCones` is the only one to set them, and it
        // raises this flag at the same time. The WebGL2 engine does not call it and therefore no
        // longer pays a `cone` read per tested cluster.
        cones: false,
        // Each record receives `min` and `max` from the manifest, which the page contract makes
        // mandatory: the root declares it, and the cut stops checking it per cluster.
        boxes: true,
        parked,
        placement,
        ...(neverCulled(surface) ? { unculled: true } : {}),
      });
      // The clusters nothing replaces are the coarsest complete cover; they stay resident so the cut
      // always has something to fall back on.
      if (structure) for (const root of structure.roots) bootstrap.push(pages[root]);
    }
    order++;
  }
  return {
    roots,
    allPages,
    worlds,
    blendCopies,
    bootstrap,
    requestCount: indexPageRequests(allPages),
    prepared: metadata.primitives.reduce((n, p) => n + p.pages.length, 0),
  };
}
