import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createExactPagesMaterials } from './exactPagesMaterials.ts';
import { clusterColor } from './hostSceneObjects.ts';
import { hashId, screenErrorColor } from './diagnosticColors.ts';
import { triangleGeometry } from './triangleDiagnostic.ts';
import { hostDiagnostics } from './threeSceneAdapter.ts';
import type { EngineCamera } from './cameraWorld.ts';
import type { PageRec } from './pageSelection.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';

/** A cluster page as this file reads it: the host declaration, the identity, and the two
 *  facts the pages and the level-of-detail views colour by. */
function page(
  clusterId: string,
  declaration: THREE.Material | THREE.Material[],
  extra: Partial<PageRec> = {},
) {
  return { clusterId, declaration, lodError: 0, ...extra } as unknown as PageRec;
}
function indexedQuad() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}
function materials(diagnostic: DiagnosticMode, blendCopies: THREE.Mesh[] = []) {
  const options = {
    blendCopies,
    viewport: [640, 400] as const,
    diagnostic,
    cam: undefined as EngineCamera | undefined,
    lastPixelError: 1,
  };
  return { options, made: createExactPagesMaterials(options) };
}

test('the beauty view hands back the host declaration itself, untouched', () => {
  const declaration = new THREE.MeshStandardMaterial();
  const { made } = materials('beauty');
  assert.equal(made.materialFor(page('c1', declaration)), declaration);
  made.disposeMaterials();
  declaration.dispose();
});

test('the wireframe view is one unshaded vertex-colour surface per cluster, on the declared side', () => {
  const declaration = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const { made } = materials('wireframe');
  const first = made.materialFor(page('c1', declaration)) as THREE.MeshBasicMaterial;
  assert.ok(first instanceof THREE.MeshBasicMaterial);
  assert.equal(first.vertexColors, true);
  assert.equal(first.wireframe, false, 'the triangles are coloured, not outlined');
  assert.equal(first.side, THREE.DoubleSide);
  assert.equal(made.materialFor(page('c1', declaration)), first, 'one surface per cluster');
  assert.notEqual(made.materialFor(page('c2', declaration)), first);
  made.disposeMaterials();
  declaration.dispose();
});

test('the pages, level-of-detail and cluster views colour by residency, role and identity', () => {
  const declaration = new THREE.MeshStandardMaterial();
  const resident = page('c1', declaration, { array: new Uint32Array(1) }),
    loading = page('c2', declaration);
  const pages = materials('pages').made;
  assert.equal((pages.materialFor(resident) as THREE.MeshBasicMaterial).color.getHex(), 0x34d399);
  assert.equal((pages.materialFor(loading) as THREE.MeshBasicMaterial).color.getHex(), 0xfbbf24);
  assert.equal(pages.materialFor(page('c9', declaration)), pages.materialFor(loading));
  const lod = materials('lod').made;
  const coarse = page('c1', declaration, { role: 'coarse' }),
    exact = page('c2', declaration, { role: 'exact' });
  assert.equal((lod.materialFor(coarse) as THREE.MeshBasicMaterial).color.getHex(), 0xf59e0b);
  assert.equal((lod.materialFor(exact) as THREE.MeshBasicMaterial).color.getHex(), 0x38bdf8);
  const clusters = materials('clusters').made;
  const tint = clusters.materialFor(page('c1', declaration)) as THREE.MeshBasicMaterial;
  assert.deepEqual(tint.color.toArray(), clusterColor('c1', 0.75).toArray());
  for (const set of [pages, lod, clusters]) set.disposeMaterials();
  declaration.dispose();
});

test('the screen-error view rewrites its colour from the error the page projects', () => {
  const declaration = new THREE.MeshStandardMaterial();
  const { options, made } = materials('screen-error');
  const rec = page('c1', declaration);
  assert.equal((made.materialFor(rec) as THREE.MeshBasicMaterial).color.getHex(), 0x00ff1f);
  options.cam = {} as EngineCamera;
  const painted = made.materialFor(rec) as THREE.MeshBasicMaterial;
  assert.deepEqual(painted.color.toArray(), screenErrorColor(0, 1));
  made.disposeMaterials();
  declaration.dispose();
});

test('painting a page swaps the expanded triangles in under wireframe and the source elsewhere', () => {
  const geometry = indexedQuad(),
    declaration = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), declaration);
  const wireframe = materials('wireframe').made;
  wireframe.paint(mesh, geometry, declaration, hashId('c1'));
  assert.equal(mesh.geometry, triangleGeometry(geometry, hostDiagnostics, hashId('c1')));
  assert.equal(mesh.geometry.getIndex(), null);
  assert.equal(mesh.geometry.getAttribute('color').count, 6);
  materials('pages').made.paint(mesh, geometry, declaration);
  assert.equal(mesh.geometry, geometry, 'every other view draws the source geometry');
  wireframe.disposeMaterials();
  geometry.dispose();
  declaration.dispose();
});

test('a transparent copy is repainted like a page, on its own identity, and given back on beauty', () => {
  const geometry = indexedQuad(),
    declaration = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 });
  const copy = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  copy.userData.sourceGeometry = geometry;
  copy.userData.sourceMaterial = declaration;
  const wireframe = materials('wireframe', [copy]).made;
  wireframe.paintBlend();
  const painted = copy.material as THREE.MeshBasicMaterial;
  assert.ok(painted instanceof THREE.MeshBasicMaterial);
  assert.equal(painted.vertexColors, true);
  assert.equal(copy.geometry, triangleGeometry(geometry, hostDiagnostics, hashId(copy.uuid)));
  wireframe.paintBlend();
  assert.equal(copy.material, painted, 'one surface per transparent copy, kept across frames');
  const beauty = materials('beauty', [copy]).made;
  beauty.paintBlend();
  assert.equal(copy.material, declaration, 'the transparent copy gets its own surface back');
  assert.equal(copy.geometry, geometry);
  wireframe.disposeMaterials();
  geometry.dispose();
  declaration.dispose();
});

test('disposing releases every surface the views made, and none of the host declarations', () => {
  const declaration = new THREE.MeshStandardMaterial();
  const { made } = materials('clusters');
  const tint = made.materialFor(page('c1', declaration)) as THREE.MeshBasicMaterial;
  let disposed = 0;
  tint.addEventListener('dispose', () => disposed++);
  made.disposeMaterials();
  assert.equal(disposed, 1);
  assert.equal(made.materialFor(page('c1', declaration)), tint, 'the table is the caller’s');
  declaration.dispose();
});
