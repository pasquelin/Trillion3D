import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type {ClusterManifest} from '../sdk-core/index.ts';
import {collectClusterPages,rootCoverage,selectVisiblePages} from './pageSelection.ts';
import {cameraSelectionUniforms,evaluateSelectionKernel,packSelectionForest} from './gpuSelection.ts';

function blendFixture(material:THREE.Material=new THREE.MeshBasicMaterial({transparent:true,side:THREE.DoubleSide})){
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,0,1,0,99,-1,0,101,-1,0,100,1,0],3));
 geometry.setIndex([0,1,2,3,4,5]);
 const mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[
  {id:0,url:'near',count:3,bytes:12,sha256:'near',min:[-1,-1,0],max:[1,1,0],role:'exact' as const},
  {id:1,url:'far',count:3,bytes:12,sha256:'far',min:[99,-1,0],max:[101,1,0],role:'exact' as const},
 ];
 const metadata={clusterStrategy:'spatial-morton',primitives:[{mesh:0,primitive:0,pass:'clustered-blend',pages,hierarchy:{min:[-1,-1,0],max:[101,1,0],children:pages.map(page=>({min:page.min,max:page.max,page:page.id}))}}]} as ClusterManifest;
 const indices=new Map([['near',new Uint32Array([0,1,2])],['far',new Uint32Array([3,4,5])]]);
 const associations=new Map([[mesh,{meshes:0,primitives:0}]]);
 return {geometry,material,mesh,source,metadata,indices,associations};
}

function camera(){const camera=new THREE.PerspectiveCamera(55,1,.1,1000);camera.position.z=5;camera.lookAt(0,0,0);camera.updateMatrixWorld();return camera;}

test('clustered blend pages retain their source and only select the intersecting part of a mesh',()=>{
 const fixture=blendFixture();
 const {roots,allPages,blendCopies}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 assert.equal(blendCopies.length,0);
 assert.equal(allPages.length,2);
 for(const page of allPages){assert.equal(page.transparent,true);assert.equal(page.sourceMesh,fixture.mesh);}
 const selected=selectVisiblePages(roots,camera(),{pixelError:100,viewport:[960,540],frame:1,holdResident:true});
 assert.deepEqual(selected.shown.map(page=>page.url),['near']);
 assert.equal(selected.displayedTriangles,1);
 assert.equal(selected.complete,true);
 assert.deepEqual(rootCoverage(roots).map(page=>page.url),['near','far']);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('clustered blend validates source order even with a spatial strategy for opaque pages',()=>{
 const fixture=blendFixture();
 fixture.indices.set('near',new Uint32Array([3,4,5]));fixture.indices.set('far',new Uint32Array([0,1,2]));
 assert.throws(()=>collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations),/Page\/source index mismatch/);
 fixture.metadata.primitives[0].pass='exact-clusters';
 assert.doesNotThrow(()=>collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations));
 fixture.geometry.dispose();fixture.material.dispose();
});

test('primitive cluster strategy overrides the scene strategy for exact index validation',()=>{
 const fixture=blendFixture();fixture.metadata.primitives[0].pass='exact-clusters';
 fixture.metadata.primitives[0].clusterStrategy='exact-source-order';
 fixture.indices.set('near',new Uint32Array([3,4,5]));fixture.indices.set('far',new Uint32Array([0,1,2]));
 assert.throws(()=>collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations),/Page\/source index mismatch/);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('coarse transparent pages inherit source order and retain their own page sequence',()=>{
 const fixture=blendFixture();const primitive=fixture.metadata.primitives[0];
 primitive.pages.push({...primitive.pages[0],id:2,url:'coarse-a',role:'coarse'},{...primitive.pages[0],id:3,url:'coarse-b',role:'coarse'});
 primitive.hierarchy!.coarsePages=[2,3];primitive.hierarchy!.errorObject=0;
 fixture.indices.set('coarse-a',new Uint32Array([0,1,2]));fixture.indices.set('coarse-b',new Uint32Array([3,4,5]));
 const {allPages}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 assert.deepEqual(allPages.map(page=>page.sourceOrder),[0,1,0,1/3]);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('clustered blend never reports missing exact coverage as resident',()=>{
 const fixture=blendFixture();fixture.indices.delete('near');
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations,{allowMissing:true});
 const selected=selectVisiblePages(roots,camera(),{frame:1,holdResident:true});
 assert.equal(selected.complete,false);
 assert.deepEqual(selected.wanted.map(page=>page.url),['near']);
 assert.deepEqual(selected.shown,[]);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('double-sided blend pages survive backface cones in CPU and packed GPU selection',()=>{
 const fixture=blendFixture();
 const {roots,allPages}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 allPages[0].cone={axis:[0,0,-1],angle:0};
 const cam=camera(),packed=packSelectionForest(roots);
 const cpu=selectVisiblePages(roots,cam,{frame:1});
 const gpu=evaluateSelectionKernel(packed,cameraSelectionUniforms(cam,0,[960,540]));
 assert.deepEqual(cpu.shown.map(page=>page.url),['near']);
 assert.deepEqual(gpu.pageIds.map(id=>packed.pageUrls[id]),['near']);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('clustered blend classification remains explicit if material transparency was disabled',()=>{
 const fixture=blendFixture(new THREE.MeshBasicMaterial());
 const collected=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 assert.equal(collected.allPages[0].transparent,true);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('transparent source materials on legacy exact pages still use the forward pass',()=>{
 const fixture=blendFixture();fixture.metadata.primitives[0].pass='exact-clusters';
 const collected=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 assert.equal(collected.allPages[0].transparent,true);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('shared blend and runtime transmission keep their full source fallback',()=>{
 for(const pass of ['shared-blend','clustered-blend']){
  const material=pass==='clustered-blend'?new THREE.MeshPhysicalMaterial({transmission:1}):new THREE.MeshBasicMaterial({transparent:true});
  const fixture=blendFixture(material);fixture.metadata.primitives[0].pass=pass;
  const collected=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
  assert.equal(collected.allPages.length,0);
  assert.equal(collected.roots.length,0);
  assert.equal(collected.blendCopies.length,1);
  assert.equal(collected.blendCopies[0].geometry,fixture.geometry);
  fixture.geometry.dispose();fixture.material.dispose();
 }
});
