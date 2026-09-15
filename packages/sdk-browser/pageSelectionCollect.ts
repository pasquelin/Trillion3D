import type { ClusterManifest } from '../sdk-core/index.ts';
import * as THREE from 'three';
import { isTransmissive } from './visibilityBuffer.ts';
import { objects } from './pageSelectionHelpers.ts';
import { primitiveFinder } from './primitiveLookup.ts';
import { createPrimitiveTemplates } from './pageSelectionTemplate.ts';
import { indexPageRequests } from './pageSelectionRequests.ts';
import type { PageRec, ClusterRoot } from './pageSelectionTypes.ts';

export function collectClusterPages(
  source: THREE.Object3D,
  metadata: ClusterManifest,
  indices: Map<string, Uint32Array>,
  associations: Map<THREE.Object3D, { meshes?: number; primitives?: number }>,
  options: { allowMissing?: boolean } = {},
) {
  const roots: Array<ClusterRoot<PageRec>> = [],
    allPages: PageRec[] = [],
    blendCopies: THREE.Mesh[] = [],
    bootstrap: PageRec[] = [];
  const primitiveOf = primitiveFinder(metadata.primitives);
  // Un gabarit par objet source, partagé par tous ses placements : la forme du DAG, ses bandes
  // d'erreur et ses identités de clusters ne dépendent d'aucune matrice monde.
  const templates = createPrimitiveTemplates(indices, options.allowMissing === true);
  let order = 0;
  for (const mesh of objects(source)) {
    const primitive = primitiveOf(associations.get(mesh));
    if (!primitive) throw new Error(`Missing primitive association: ${mesh.name}`);
    if (primitive.pass === 'shared-blend' || isTransmissive(mesh.material)) {
      const copy = new THREE.Mesh(mesh.geometry, mesh.material);
      copy.matrixAutoUpdate = false;
      copy.matrix.copy(mesh.matrixWorld);
      copy.frustumCulled = mesh.frustumCulled;
      copy.renderOrder = order++;
      copy.userData.sourceMesh = mesh;
      blendCopies.push(copy);
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
        matrix: mesh.matrixWorld,
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
    roots.push({
      world: mesh.matrixWorld,
      pages,
      culling: culling && { ...culling, bounds: shape.bounds! },
      worldBox: shape.local.clone().applyMatrix4(mesh.matrixWorld),
      localBox: shape.local.clone(),
      structure,
      forced: structure ? new Uint8Array(structure.groupCount) : undefined,
      forcedList: structure ? [] : undefined,
      // Aucune page collectée ne porte de cône : `prepareCones` est le seul à en poser, et il
      // relève ce drapeau en même temps. Le moteur WebGL2 ne l'appelle pas et ne paie donc plus
      // une lecture de `cone` par cluster retenu.
      cones: false,
    });
    // The clusters nothing replaces are the coarsest complete cover; they stay resident so the cut
    // always has something to fall back on.
    if (structure) for (const root of structure.roots) bootstrap.push(pages[root]);
  }
  return {
    roots,
    allPages,
    blendCopies,
    bootstrap,
    requestCount: indexPageRequests(allPages),
    prepared: metadata.primitives.reduce((n, p) => n + p.pages.length, 0),
  };
}
