// Batch F oracles, loading side: `pageSelectionCollect.ts:34-153`, `explorerScene.ts:18-36` and
// `explorerPageSources.ts:20-49` from before batch F, copied as-is.
import * as THREE from 'three';
import {
  DAG_ERROR_MODEL,
  EngineError,
  primitiveUsesClusterErrors,
  type ClusterManifest,
} from '../../../sdk-core/index.ts';
import type { BackendContext } from '../../backendTypes.ts';
import type { PageRec, ClusterRoot } from '../../pageSelectionTypes.ts';
import { isTransmissive } from '../../visibilityBuffer.ts';
import {
  objects,
  streamPlacement,
  clusterErrorFields,
  cullingNodes,
} from '../../pageSelectionHelpers.ts';
import { structureIndex } from '../../pageSelectionStructure.ts';
import { cullingBounds } from '../../pageSelectionCutBounds.ts';
import { indexPageRequests } from '../../pageSelectionRequests.ts';
import { surfaceOf } from '../../pageSurface.ts';

type Primitive = ClusterManifest['primitives'][number];

/** A cluster root before batch F: the world and local box are `THREE.Box3` instances, where the
 *  attached version now keeps them flat (`Float64Array`) — the difference `boiteVersTableau`
 *  reads in the bench. Everything else matches `ClusterRoot<PageRec>`. */
type ReferenceRoot = Omit<ClusterRoot<PageRec>, 'worldBox' | 'localBox'> & {
  worldBox: THREE.Box3;
  localBox: THREE.Box3;
  forcedList: number[] | undefined;
};

/** `collectClusterPages` before batch F: `find` per mesh, `flatMap` of a spread, three
 *  Three.js objects per page for the box union. */
export function referenceCollectClusterPages(
  source: THREE.Object3D,
  metadata: ClusterManifest,
  indices: Map<string, Uint32Array>,
  associations: BackendContext['associations'],
  options: { allowMissing?: boolean } = {},
) {
  const roots: ReferenceRoot[] = [],
    allPages: PageRec[] = [],
    blendCopies: THREE.Mesh[] = [],
    bootstrap: PageRec[] = [];
  const structures = new Map<Primitive, ReturnType<typeof structureIndex>>();
  let order = 0;
  // `meshes` resolved the host subtree before batch 8; the witness now resolves it
  // itself, since it reads `matrixWorld` — what it computes does not change by a bit.
  source.updateMatrixWorld(true);
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
    const src = sourceIndices.array;
    const transparent =
      primitive.pass === 'clustered-blend' ||
      (Array.isArray(mesh.material)
        ? mesh.material.some((material) => material.transparent)
        : mesh.material.transparent);
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
      const rec = {
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
        material: surfaceOf(mesh.material),
        declaration: mesh.material,
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
    if (complete) {
      const count = (arr: ArrayLike<number>) => {
        const map = new Map<string, number>();
        for (let i = 0; i < arr.length; i += 3) {
          const key = `${arr[i]},${arr[i + 1]},${arr[i + 2]}`;
          map.set(key, (map.get(key) ?? 0) + 1);
        }
        return map;
      };
      const fromPages = count(exactPages.flatMap((page) => [...(indices.get(page.url) ?? [])]));
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
        local.union(new THREE.Box3(new THREE.Vector3(...page.min), new THREE.Vector3(...page.max)));
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
