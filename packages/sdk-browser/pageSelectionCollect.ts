import { BOX_VALUES, boxTransform, type ClusterManifest } from '../sdk-core/index.ts';
import type { HostNode } from './hostResources.ts';
import type { HostGraphNode } from './hostGraphNodes.ts';
import { meshSurface } from './pageSurface.ts';
import type { BlendCopy } from './blendCopyContract.ts';
import { createBlendCopyRecord } from './blendCopyRecord.ts';
import { objects, quantizationErrorOf } from './pageSelectionHelpers.ts';
import { primitiveFinder } from './primitiveLookup.ts';
import { createPrimitiveTemplates } from './pageSelectionTemplate.ts';
import { indexPageRequests } from './pageSelectionRequests.ts';
import { hostWorldPlacements } from './hostWorldPlacements.ts';
import type { PageRec, ClusterRoot } from './pageSelectionTypes.ts';

export function collectClusterPages(
  source: HostGraphNode,
  metadata: ClusterManifest,
  indices: Map<string, Uint32Array>,
  associations: Map<HostNode, { meshes?: number; primitives?: number }>,
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
  // A transparent surface leaves the collection as the engine's own record. A witness that draws
  // it with a host renderer hands in a builder of host meshes instead (`blendCopyMesh.ts`).
  const blendCopy = options.blendCopy ?? createBlendCopyRecord;
  // One template per source object, shared by all its placements: the DAG shape, its error
  // bands and cluster identities depend on no world matrix.
  const templates = createPrimitiveTemplates(indices, options.allowMissing === true);
  let order = 0;
  for (const mesh of objects(source)) {
    const primitive = primitiveOf(associations.get(mesh));
    if (!primitive) throw new Error(`Missing primitive association: ${mesh.name}`);
    const world = worlds.of(mesh);
    // The surface the declaration wears, read at the boundary into the engine's own record:
    // from here on this collection and everything it feeds hold records, not host materials.
    const surface = meshSurface(mesh);
    if (primitive.pass === 'shared-blend' || surface.transmission > 0) {
      blendCopies.push(blendCopy(mesh, order++, world, surface));
      continue;
    }
    const template = templates.pagesOf(primitive);
    const transparent = primitive.pass === 'clustered-blend' || surface.transparent;
    // The grid moved every position of this primitive by at most this much: its clusters' boxes
    // grow by it, so culling still encloses the surface an engine draws from the pages.
    const slack = quantizationErrorOf(primitive);
    const widen = (bounds: number[], sign: number) =>
      slack > 0 ? bounds.map((value) => value + sign * slack) : bounds;
    // A flat cut has no tree; transparent pages recover their draw order from the recorded source rank.
    const sourceOrder = transparent ? template.sourceOrder : undefined;
    const pages = primitive.pages.map((page, pageIndex) => {
      const entry = template.pages[pageIndex],
        cut = entry.cut,
        placed = entry.placed;
      const rec: PageRec = {
        id: page.id,
        url: page.url,
        clusterId: entry.clusterId,
        array: entry.array,
        triangles: page.count / 3,
        indexBytes: entry.array?.byteLength ?? page.bytes,
        // A transparent cluster keeps its index page: its forward draw reads an index buffer and
        // the source vertices, which no page replaces (`webgpuBlendShader.ts`).
        geometryPage: transparent ? undefined : page.geometry,
        min: widen(page.min, -1),
        max: widen(page.max, 1),
        role: page.role,
        level: cut.level,
        lodError: cut.lodError,
        sphere: cut.sphere,
        parentError: cut.parentError,
        parentSphere: cut.parentSphere,
        group: cut.group,
        source: cut.source,
        streamUrl: placed?.url,
        streamOffset: placed?.offset,
        depthLayer: page.depthLayer ?? 0,
        attributes: mesh.geometry.attributes,
        material: surface,
        declaration: mesh.material,
        transparent,
        sourceMesh: mesh,
        sourceOrder: sourceOrder?.[pageIndex] ?? pageIndex,
        matrix: world,
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
    order++;
    const shape = templates.shapeOf(primitive, template);
    const { structure, culling } = shape;
    const worldBox = new Float64Array(BOX_VALUES);
    boxTransform(worldBox, 0, shape.local, 0, world.elements);
    roots.push({
      world,
      pages,
      // Nodes, their bounds and their links belong to the primitive and are shared by all its
      // placements; only the force marks are proper to this placement.
      culling: culling && {
        ...culling,
        bounds: shape.bounds!,
        links: shape.links,
        marks: structure ? new Int32Array(culling.nodes.length / culling.stride) : undefined,
      },
      worldBox,
      localBox: shape.local.slice(),
      structure,
      forced: structure ? new Uint8Array(structure.groupCount) : undefined,
      forcedList: structure ? [] : undefined,
      // No collected page carries a cone: `prepareCones` is the only one to set them, and it
      // raises this flag at the same time. The WebGL2 engine does not call it and therefore no
      // longer pays a `cone` read per tested cluster.
      cones: false,
      // Each record receives `min` and `max` from the manifest, which the page contract makes
      // mandatory: the root declares it, and the cut stops checking it per cluster.
      boxes: true,
    });
    // The clusters nothing replaces are the coarsest complete cover; they stay resident so the cut
    // always has something to fall back on.
    if (structure) for (const root of structure.roots) bootstrap.push(pages[root]);
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
