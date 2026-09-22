import { BOX_VALUES, boxTransform, type ClusterManifest } from '../sdk-core/index.ts';
import type { HostNode } from './hostResources.ts';
import * as THREE from 'three';
import { isTransmissive } from './visibilityBuffer.ts';
import type { BlendCopy } from './blendCopyContract.ts';
import { createBlendCopy } from './blendCopyMesh.ts';
import { objects } from './pageSelectionHelpers.ts';
import { primitiveFinder } from './primitiveLookup.ts';
import { createPrimitiveTemplates } from './pageSelectionTemplate.ts';
import { indexPageRequests } from './pageSelectionRequests.ts';
import { hostWorldPlacements } from './hostWorldPlacements.ts';
import type { PageRec, ClusterRoot } from './pageSelectionTypes.ts';

export function collectClusterPages(
  source: HostNode,
  metadata: ClusterManifest,
  indices: Map<string, Uint32Array>,
  associations: Map<HostNode, { meshes?: number; primitives?: number }>,
  options: { allowMissing?: boolean } = {},
) {
  // World matrices of pages and roots are the ENGINE's, computed from the host's local poses:
  // no record any longer carries the live `matrixWorld` of its mesh.
  const worlds = hostWorldPlacements(source);
  const roots: Array<ClusterRoot<PageRec>> = [],
    allPages: PageRec[] = [],
    blendCopies: BlendCopy[] = [],
    bootstrap: PageRec[] = [];
  const primitiveOf = primitiveFinder(metadata.primitives);
  // One template per source object, shared by all its placements: the DAG shape, its error
  // bands and cluster identities depend on no world matrix.
  const templates = createPrimitiveTemplates(indices, options.allowMissing === true);
  let order = 0;
  for (const mesh of objects(source)) {
    const primitive = primitiveOf(associations.get(mesh));
    if (!primitive) throw new Error(`Missing primitive association: ${mesh.name}`);
    const world = worlds.of(mesh);
    if (primitive.pass === 'shared-blend' || isTransmissive(mesh.material)) {
      blendCopies.push(createBlendCopy(mesh, order++, world));
      continue;
    }
    const sourceIndices = mesh.geometry.getIndex();
    if (!sourceIndices) throw new Error('Indexed source required');
    const template = templates.pagesOf(primitive);
    const transparent =
      primitive.pass === 'clustered-blend' ||
      (Array.isArray(mesh.material)
        ? mesh.material.some((material) => material.transparent)
        : mesh.material.transparent);
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
        min: page.min,
        max: page.max,
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
        material: mesh.material,
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
    if (template.complete && template.sourceOffset !== sourceIndices.count)
      throw new Error('Incomplete cluster coverage');
    templates.checkCoverage(primitive, template, sourceIndices.array as ArrayLike<number>);
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
