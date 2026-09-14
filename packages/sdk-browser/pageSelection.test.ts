import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  collectClusterPages,
  rootCoverage,
  selectVisiblePages,
  type PageRec,
  type SelectionResult,
} from './pageSelection.ts';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { evaluateDagSelectionKernel, packDagSelection } from './gpuDagSelection.ts';
import { blendFixture, camera } from './pageSelectionBlendFixture.ts';

test('clustered blend pages retain their source and only select the intersecting part of a mesh', () => {
  const fixture = blendFixture();
  const { roots, allPages, blendCopies } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  assert.equal(blendCopies.length, 0);
  assert.equal(allPages.length, 2);
  for (const page of allPages) {
    assert.equal(page.transparent, true);
    assert.equal(page.sourceMesh, fixture.mesh);
  }
  const selected = selectVisiblePages(roots, camera(), {
    pixelError: 100,
    viewport: [960, 540],
    frame: 1,
    holdResident: true,
  });
  assert.deepEqual(
    selected.shown.map((page) => page.url),
    ['near'],
  );
  assert.equal(selected.displayedTriangles, 1);
  assert.equal(selected.complete, true);
  assert.deepEqual(
    rootCoverage(roots).map((page) => page.url),
    ['near', 'far'],
  );
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('clustered blend never reports missing exact coverage as resident', () => {
  const fixture = blendFixture();
  fixture.indices.delete('near');
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
    { allowMissing: true },
  );
  const selected = selectVisiblePages(roots, camera(), { frame: 1, holdResident: true });
  assert.equal(selected.complete, false);
  assert.deepEqual(
    selected.wanted.map((page) => page.url),
    ['near'],
  );
  assert.deepEqual(selected.shown, []);
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('double-sided blend pages survive backface cones in CPU and packed GPU selection', () => {
  const fixture = blendFixture();
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  allPages[0].cone = { axis: [0, 0, -1], angle: 0 };
  const cam = camera(),
    packed = packDagSelection(roots);
  const cpu = selectVisiblePages(roots, cam, { frame: 1 });
  const gpu = evaluateDagSelectionKernel(packed, cameraSelectionUniforms(cam, 0, [960, 540]));
  assert.deepEqual(
    cpu.shown.map((page) => page.url),
    ['near'],
  );
  assert.deepEqual(
    gpu.pageIds.map((id) => packed.pageUrls[id]),
    ['near'],
  );
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('clustered blend classification remains explicit if material transparency was disabled', () => {
  const fixture = blendFixture(new THREE.MeshBasicMaterial());
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  assert.equal(collected.allPages[0].transparent, true);
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('transparent source materials on legacy exact pages still use the forward pass', () => {
  const fixture = blendFixture();
  fixture.metadata.primitives[0].pass = 'exact-clusters';
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  assert.equal(collected.allPages[0].transparent, true);
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('shared blend and runtime transmission keep their full source fallback', () => {
  for (const pass of ['shared-blend', 'clustered-blend']) {
    const material =
      pass === 'clustered-blend'
        ? new THREE.MeshPhysicalMaterial({ transmission: 1 })
        : new THREE.MeshBasicMaterial({ transparent: true });
    const fixture = blendFixture(material);
    fixture.metadata.primitives[0].pass = pass;
    const collected = collectClusterPages(
      fixture.source,
      fixture.metadata,
      fixture.indices,
      fixture.associations,
    );
    assert.equal(collected.allPages.length, 0);
    assert.equal(collected.roots.length, 0);
    assert.equal(collected.blendCopies.length, 1);
    assert.equal(collected.blendCopies[0].geometry, fixture.geometry);
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('une image de coupe réutilise sa table plate, son résultat et ses tableaux : elle n\'alloue rien',()=>{
 const fixture=blendFixture();
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 const table=roots[0].table,shown:PageRec[]=[],wanted:PageRec[]=[];
 const result:SelectionResult<PageRec>={shown,wanted,visible:0,selectedTriangles:0,displayedTriangles:0,frustumRejected:0,lodLevel:0,complete:true,pixelError:0};
 const cam=camera(),ask={pixelError:100,viewport:[960,540] as [number,number],frame:1,holdResident:true,wanted,result};
 const first=selectVisiblePages(roots,cam,ask,shown);
 ask.frame=2;
 const second=selectVisiblePages(roots,cam,ask,shown);
 assert.equal(second,first,'le résultat rendu est celui fourni, image après image');
 assert.equal(second,result);
 assert.equal(second.shown,shown);
 assert.equal(second.wanted,wanted);
 assert.equal(roots[0].table,table,'la table plate est construite avec la primitive, jamais par image');
 assert.deepEqual(second.shown.map(page=>page.url),['near']);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('une bande de cluster invalide est refusée à la préparation, pas au milieu d\'une image',()=>{
 const fixture=blendFixture();
 // La sphère propre est déjà validée au chargement ; celle du remplaçant ne l'était nulle part.
 const page=fixture.metadata.primitives[0].pages[0] as {parentError:number|null;parentSphere:number[]|null};
 page.parentError=1;page.parentSphere=[0,0,0,-1];
 assert.throws(()=>collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations),/Parametres de cluster invalides/);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('deux appels successifs avec la même caméra sélectionnent le même ensemble de clusters',()=>{
 const fixture=blendFixture();
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 const cam=camera();
 const shown1:PageRec[]=[];
 const first=selectVisiblePages(roots,cam,{pixelError:100,viewport:[960,540],frame:1,holdResident:true},shown1);
 const shown2:PageRec[]=[];
 const second=selectVisiblePages(roots,cam,{pixelError:100,viewport:[960,540],frame:2,holdResident:true},shown2);
 assert.deepEqual(first.shown.map(p=>p.url),second.shown.map(p=>p.url),'même ensemble montré');
 assert.deepEqual(first.wanted.map(p=>p.url),second.wanted.map(p=>p.url),'même ensemble voulu');
 assert.equal(first.frustumRejected,second.frustumRejected,'même rejet frustum');
 assert.equal(first.lodLevel,second.lodLevel,'même niveau LOD');
 fixture.geometry.dispose();fixture.material.dispose();
});

test('les tableaux de travail de la sélection sont réutilisés d\'une image à l\'autre',()=>{
 const fixture=blendFixture();
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 const cam=camera(),ask={pixelError:100,viewport:[960,540] as [number,number],frame:0,holdResident:true};
 const hint:PageRec[]=[];
 const first=selectVisiblePages(roots,cam,ask,hint);
 ask.frame=1;
 const second=selectVisiblePages(roots,cam,ask,hint);
 assert.deepEqual(first.shown.map(p=>p.url),second.shown.map(p=>p.url),'même ensemble montré');
 assert.deepEqual(first.wanted.map(p=>p.url),second.wanted.map(p=>p.url),'même ensemble voulu');
 assert.equal(first.frustumRejected,second.frustumRejected,'même rejet frustum');
 fixture.geometry.dispose();fixture.material.dispose();
});
