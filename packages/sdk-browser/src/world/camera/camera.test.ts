// Batch M4a, camera.ts: framing by flat bounds and core `sphereFromBounds` instead of
// Three's `Box3`/`getCenter`/`getSize().length()/2`. Confronted bit for bit (Object.is) with the old
// path, autonomous and non-autonomous, on hostile bounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createExplorerCamera } from './camera.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import { assertBits } from '../../../../../tests/kit/assert/bits.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import { threeGraph } from '../../../../../bench/witnesses/three/fromGraphNodes.ts';

const canvas = { width: 800, height: 450 } as unknown as HTMLCanvasElement;

/** The old non-autonomous path: `expandByObject` per mesh, `getCenter`/`getSize().length()/2`. */
function referenceFraming(graph: G.GraphNode) {
  const source = threeGraph(graph);
  const bounds = new THREE.Box3();
  source.updateMatrixWorld(true); // the old `objects()` of ../../scene/meshes.ts resolved the subtree before walking it
  source.traverse((o: THREE.Object3D) => {
    if ((o as THREE.Mesh).isMesh) bounds.expandByObject(o as THREE.Mesh);
  });
  const center = bounds.getCenter(new THREE.Vector3()),
    radius = bounds.getSize(new THREE.Vector3()).length() / 2;
  return { bounds, center, radius };
}

/** Hostile subtree, depth 3: negative then non-uniform scale. */
function hostileScene() {
  const racine = new G.GraphGroup();
  racine.scale.set(-3, 1, 1);
  const enfant = new G.GraphGroup();
  enfant.position.set(2, -4, 6);
  enfant.scale.set(1, 0.25, 5);
  racine.add(enfant);
  const petitEnfant = new G.GraphGroup();
  petitEnfant.position.set(1, 1, 1);
  enfant.add(petitEnfant);
  const mesh = G.mesh(G.boxGeometry(2, 3, 4), G.basicSurface());
  mesh.position.set(-1, 2, -3);
  petitEnfant.add(mesh);
  return racine;
}

test('createExplorerCamera (non-autonomous) yields the same bounds, centre and radius as expandByObject + getCenter/getSize().length()/2', () => {
  const source = hostileScene();
  const { bounds: b, center, radius } = referenceFraming(source);
  const rendu = createExplorerCamera(
    hostileScene(),
    false,
    new Map(),
    { primitives: [] } as unknown as ClusterManifest,
    canvas,
    { manifestUrl: '' },
  );
  assertBits(
    [rendu.bounds.min.x, rendu.bounds.min.y, rendu.bounds.min.z],
    [b.min.x, b.min.y, b.min.z],
  );
  assertBits(
    [rendu.bounds.max.x, rendu.bounds.max.y, rendu.bounds.max.z],
    [b.max.x, b.max.y, b.max.z],
  );
  assertBits([rendu.center.x, rendu.center.y, rendu.center.z], [center.x, center.y, center.z]);
  assert.ok(Object.is(rendu.radius, radius), `rayon : ${rendu.radius} !== ${radius}`);
});

test('createExplorerCamera (autonomous) yields the same bounds, centre and radius as the reference pagesBounds/expandByObject', () => {
  const geometry = new G.GraphGeometry();
  const source = new G.GraphGroup();
  const mesh = G.mesh(geometry, G.basicSurface());
  mesh.position.set(4, -2, 0);
  source.add(mesh);
  const metadata = {
    primitives: [{ mesh: 0, primitive: 0, pages: [{ id: 0, min: [-1, -1, -1], max: [1, 1, 1] }] }],
  } as unknown as ClusterManifest;
  const associations = new Map<G.GraphMesh, { meshes: number; primitives: number }>([
    [mesh, { meshes: 0, primitives: 0 }],
  ]);
  const rendu = createExplorerCamera(source, true, associations, metadata, canvas, {
    manifestUrl: '',
  });
  // Reference: the same page transformed by the mesh world matrix, via Box3.applyMatrix4.
  // The witness resolves the graph itself: since batch 8, the engine no longer composes the host's.
  source.updateMatrixWorld(true);
  const attendu = new G.Box3(new G.Vector3(-1, -1, -1), new G.Vector3(1, 1, 1)).applyMatrix4(
    mesh.matrixWorld,
  );
  const center = attendu.getCenter(new G.Vector3()),
    radius = attendu.getSize(new G.Vector3()).length() / 2;
  assertBits([rendu.center.x, rendu.center.y, rendu.center.z], [center.x, center.y, center.z]);
  assert.ok(Object.is(rendu.radius, radius));
});

test('createExplorerCamera throws on a scene with no geometry, empty bounds', () => {
  const source = new G.GraphGroup();
  source.add(new G.GraphGroup());
  assert.throws(
    () =>
      createExplorerCamera(
        source,
        false,
        new Map(),
        { primitives: [] } as unknown as ClusterManifest,
        canvas,
        { manifestUrl: '' },
      ),
    /Empty scene bounds/,
  );
});
