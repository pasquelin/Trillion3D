import {
  DAG_ERROR_MODEL,
  EngineError,
  primitiveUsesClusterErrors,
  type ClusterManifest,
  type Primitive,
} from '../sdk-core/index.ts';
import * as THREE from 'three';
import { isTransmissive } from './visibilityBuffer.ts';
import {
  objects,
  streamPlacement,
  clusterErrorFields,
  structureIndex,
  cullingNodes,
} from './pageSelectionHelpers.ts';
import { cullingBounds } from './pageSelectionCutBounds.ts';
import { indexPageRequests } from './pageSelectionRequests.ts';
import type { PageRec, ClusterRoot, ClusterStructureIndex } from './pageSelectionTypes.ts';

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
  const structures = new Map<Primitive, ClusterStructureIndex | undefined>();
  let order = 0;
  for (const mesh of objects(source)) {
    const association = associations.get(mesh),
      primitive = metadata.primitives.find(
        (p) => p.mesh === association?.meshes && p.primitive === (association?.primitives ?? 0),
      );
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
    const src = sourceIndices.array as ArrayLike<number>;
    const transparent =
      primitive.pass === 'clustered-blend' ||
      (Array.isArray(mesh.material)
        ? mesh.material.some((material) => material.transparent)
        : mesh.material.transparent);
    // A flat cut has no tree; transparent pages recover their draw order from the recorded source rank.
    const sourceOrder = transparent
      ? primitive.pages.map((page, index) => page.start ?? index)
      : undefined;
    const exactPages = primitive.pages.filter((page) => (page.role ?? 'exact') !== 'coarse');
    const placement = streamPlacement(primitive.streams, primitive.pages);
    let sourceOffset = 0;
    const pages = primitive.pages.map((page, pageIndex) => {
      const array = indices.get(page.url);
      if (!array && !options.allowMissing && indices.size) throw new Error('Missing page');
      if (array && (page.role ?? 'exact') !== 'coarse') sourceOffset += array.length;
      else if (!array && (page.role ?? 'exact') !== 'coarse') sourceOffset += page.count;
      const cut = clusterErrorFields(page);
      const placed = placement?.[pageIndex];
      const rec: PageRec = {
        id: page.id,
        url: page.url,
        clusterId: `${primitive.mesh}/${primitive.primitive}/${page.id}`,
        array,
        triangles: page.count / 3,
        indexBytes: array?.byteLength ?? page.bytes,
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
    const complete = primitive.pages.every(
      (page) => indices.has(page.url) || (page.role ?? 'exact') === 'coarse',
    );
    if (complete && sourceOffset !== sourceIndices.count)
      throw new Error('Incomplete cluster coverage');
    // The DAG reorders triangles, so coverage is a multiset identity, never an order identity.
    if (complete) {
      const count = (arr: ArrayLike<number>) => {
        const map = new Map<string, number>();
        for (let i = 0; i < arr.length; i += 3) {
          const key = `${arr[i]},${arr[i + 1]},${arr[i + 2]}`;
          map.set(key, (map.get(key) ?? 0) + 1);
        }
        return map;
      };
      const fromPages = count(exactPages.flatMap((page) => [...indices.get(page.url)!]));
      const fromSource = count(src);
      if (fromPages.size !== fromSource.size) throw new Error('Incomplete cluster coverage');
      for (const [key, n] of fromSource)
        if (fromPages.get(key) !== n) throw new Error('Page/source index mismatch');
    }
    if (!primitiveUsesClusterErrors(primitive))
      throw new EngineError(
        'STALE_CACHE',
        `Primitive ${primitive.mesh}/${primitive.primitive}: clusters without a DAG error band; recompile with ${DAG_ERROR_MODEL}`,
        { mesh: primitive.mesh, primitive: primitive.primitive, expected: DAG_ERROR_MODEL },
      );
    if (!structures.has(primitive))
      structures.set(primitive, structureIndex(primitive.structure, primitive.pages.length));
    const structure = structures.get(primitive);
    const culling = cullingNodes(primitive.culling, pages.length);
    const local = new THREE.Box3();
    if (culling)
      local.set(
        new THREE.Vector3(culling.nodes[0], culling.nodes[1], culling.nodes[2]),
        new THREE.Vector3(culling.nodes[3], culling.nodes[4], culling.nodes[5]),
      );
    else
      for (const page of primitive.pages)
        local.union(
          new THREE.Box3(
            new THREE.Vector3(...(page.min as [number, number, number])),
            new THREE.Vector3(...(page.max as [number, number, number])),
          ),
        );
    roots.push({
      world: mesh.matrixWorld,
      pages,
      culling: culling && { ...culling, bounds: cullingBounds(culling, pages) },
      worldBox: local.clone().applyMatrix4(mesh.matrixWorld),
      localBox: local.clone(),
      structure,
      forced: structure ? new Uint8Array(structure.groupCount) : undefined,
      forcedList: structure ? [] : undefined,
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
