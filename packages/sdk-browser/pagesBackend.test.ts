import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from 'three';
import {exactPagesBackend} from './index.ts';
test('exact pages report measured residency and keep only the visible set in the scene',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[0,1].map(id=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}));
 const backend=exactPagesBackend({source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy:{min:[-1,-1,0],max:[1,1,0],children:pages.map(p=>({min:p.min,max:p.max,page:p.id}))}}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),maxResidentPages:2});
 const meshes=()=>{const found:THREE.Mesh[]=[];backend.scene.traverse(o=>{if((o as THREE.Mesh).isMesh)found.push(o as THREE.Mesh);});return found;};
 assert.equal(meshes().length,0);
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);backend.render(camera);
 assert.equal(backend.metrics().clusters,2);assert.equal(backend.metrics().selectedTriangles,2);assert.equal(backend.metrics().residentPages,2);assert.equal(backend.metrics().geometryAllocationBytes,12*4+2*3*4);assert.equal(meshes().length,1);
 backend.setDiagnostic?.('pages');assert.equal(meshes().length,2);backend.setDiagnostic?.('beauty');assert.equal(meshes().length,1);
 camera.lookAt(0,0,10);backend.render(camera);assert.equal(backend.metrics().clusters,0);assert.equal(backend.metrics().selectedTriangles,0);assert.equal(backend.metrics().residentPages,0);assert.equal(meshes().length,0);
 backend.dispose();geometry.dispose();material.dispose();
});
test('exact pages refuse an incomplete surface when the visible set exceeds the resident budget',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[0,1].map(id=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}));
 const backend=exactPagesBackend({source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy:{min:[-1,-1,0],max:[1,1,0],children:pages.map(p=>({min:p.min,max:p.max,page:p.id}))}}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),maxResidentPages:1});
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
 backend.render(camera);
 assert.equal(backend.overBudget,true);
 let meshCount=0;backend.scene.traverse(o=>{if((o as THREE.Mesh).isMesh)meshCount++;});assert.equal(meshCount,1);
 assert.equal(backend.metrics().residentPages,1);
 backend.dispose();geometry.dispose();material.dispose();
});
test('exact pages select coarse LOD when the screen error is under the pixel threshold',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[
  {id:0,url:'0',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'exact' as const},
  {id:1,url:'1',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'exact' as const},
  {id:2,url:'2',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'coarse' as const},
 ];
 const hierarchy={min:[-1,-1,0],max:[1,1,0],errorObject:0,coarsePages:[2],children:[{min:[-1,-1,0],max:[1,1,0],page:0},{min:[-1,-1,0],max:[1,1,0],page:1}]};
 const backend=exactPagesBackend({source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])],['2',new Uint32Array([0,1,2])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),pixelError:10,viewport:[960,540]});
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);backend.render(camera);
 assert.equal(backend.metrics().clusters,1);assert.equal(backend.metrics().selectedTriangles,1);assert.equal(backend.metrics().lodLevel,1);
 backend.dispose();geometry.dispose();material.dispose();
});
test('pixelError is read from the context each frame',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[
  {id:0,url:'0',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'exact' as const},
  {id:1,url:'1',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'exact' as const},
  {id:2,url:'2',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'coarse' as const},
 ];
 const hierarchy={min:[-1,-1,0],max:[1,1,0],errorObject:0,coarsePages:[2],children:[{min:[-1,-1,0],max:[1,1,0],page:0},{min:[-1,-1,0],max:[1,1,0],page:1}]};
 const context={source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])],['2',new Uint32Array([0,1,2])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),pixelError:0,viewport:[960,540] as [number,number]};
 const backend=exactPagesBackend(context);
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
 backend.render(camera);assert.equal(backend.metrics().clusters,2);
 context.pixelError=10;backend.render(camera);assert.equal(backend.metrics().clusters,1);
 backend.dispose();geometry.dispose();material.dispose();
});
test('nested LOD refines the root then accepts a child coarse representation',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[
  {id:0,url:'0',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'exact' as const},
  {id:1,url:'1',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'exact' as const},
  {id:2,url:'2',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'coarse' as const},
  {id:3,url:'3',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'coarse' as const},
 ];
 const hierarchy={
  min:[-1,-1,0],max:[1,1,0],errorObject:1e6,coarsePages:[3],
  children:[{min:[-1,-1,0],max:[1,1,0],errorObject:0,coarsePages:[2],children:[{min:[-1,-1,0],max:[1,1,0],page:0},{min:[-1,-1,0],max:[1,1,0],page:1}]}],
 };
 const backend=exactPagesBackend({source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])],['2',new Uint32Array([0,1,2])],['3',new Uint32Array([0,2,3])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),pixelError:10,viewport:[960,540]});
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);backend.render(camera);
 assert.equal(backend.metrics().clusters,1);assert.equal(backend.metrics().selectedTriangles,1);assert.equal(backend.metrics().lodLevel,2);
 backend.dispose();geometry.dispose();material.dispose();
});
test('exact pages attach accepted pages in the same frame without a second frustum walk',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[0,1].map(id=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}));
 const backend=exactPagesBackend({source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy:{min:[-1,-1,0],max:[1,1,0],children:pages.map(p=>({min:p.min,max:p.max,page:p.id}))}}]},indices:new Map(),associations:new Map([[mesh,{meshes:0,primitives:0}]]),maxResidentPages:2});
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
 backend.render(camera);
 backend.acceptPage?.('0',new Uint32Array([0,1,2]));
 backend.syncResident?.();
 assert.equal(backend.metrics().residentPages,1);
 backend.acceptPage?.('1',new Uint32Array([0,2,3]));
 backend.syncResident?.();
 assert.equal(backend.metrics().residentPages,2);
 const meshes:THREE.Mesh[]=[];backend.scene.traverse(o=>{if((o as THREE.Mesh).isMesh)meshes.push(o as THREE.Mesh);});
 assert.equal(meshes.length,1);
 backend.dispose();geometry.dispose();material.dispose();
});
test('exact pages stream selected clusters: pending URLs attach on acceptPage',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[0,1].map(id=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}));
 const backend=exactPagesBackend({source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy:{min:[-1,-1,0],max:[1,1,0],children:pages.map(p=>({min:p.min,max:p.max,page:p.id}))}}]},indices:new Map(),associations:new Map([[mesh,{meshes:0,primitives:0}]]),maxResidentPages:2});
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
 backend.render(camera);
 assert.equal(backend.metrics().clusters,2);assert.equal(backend.metrics().residentPages,0);
 assert.deepEqual(backend.pendingUrls?.().sort(),['0','1']);
 backend.acceptPage?.('0',new Uint32Array([0,1,2]));backend.render(camera);
 assert.equal(backend.metrics().residentPages,1);assert.deepEqual(backend.pendingUrls?.(),['1']);
 backend.acceptPage?.('1',new Uint32Array([0,2,3]));backend.render(camera);
 assert.equal(backend.metrics().residentPages,2);assert.deepEqual(backend.pendingUrls?.(),[]);
 backend.dispose();geometry.dispose();material.dispose();
});
test('truncated LOD tree still selects exact pages omitted from the hierarchy',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[0,1].map(id=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}));
 const backend=exactPagesBackend({source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy:{min:[-1,-1,0],max:[1,1,0],page:0}}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),maxResidentPages:2});
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);backend.render(camera);
 assert.equal(backend.metrics().clusters,2);assert.equal(backend.metrics().residentPages,2);assert.equal(backend.metrics().selectedTriangles,2);
 backend.dispose();geometry.dispose();material.dispose();
});
test('page bounding sphere uses the page AABB, not the shared source mesh',()=>{
 const positions=new Float32Array(300);positions.set([-1000,-1000,-1000,1000,-1000,-1000,1000,1000,-1000],0);positions.set([-1,-1,0,1,-1,0,1,1,0],9);
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex([3,4,5]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[{id:0,url:'0',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}];
 const backend=exactPagesBackend({source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy:{min:[-1,-1,0],max:[1,1,0],page:0}}]},indices:new Map([['0',new Uint32Array([3,4,5])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]])});
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);backend.render(camera);
 const attached:THREE.Mesh[]=[];backend.scene.traverse(o=>{if((o as THREE.Mesh).isMesh)attached.push(o as THREE.Mesh);});
 assert.equal(attached.length,1);
 const sphere=attached[0].geometry.boundingSphere;assert.ok(sphere);assert.ok(sphere.radius<5,`page sphere must not scan the source mesh, got radius ${sphere.radius}`);
 backend.dispose();geometry.dispose();material.dispose();
});
test('exact pages batch clusters of the same primitive in beauty mode and unbatch in diagnostic mode',()=>{
 const g1=new THREE.BufferGeometry();g1.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));g1.setIndex([0,1,2,0,2,3]);
 const g2=new THREE.BufferGeometry();g2.setAttribute('position',new THREE.Float32BufferAttribute([2,-1,0,4,-1,0,4,1,0,2,1,0],3));g2.setIndex([0,1,2,0,2,3]);
 const m1=new THREE.Mesh(g1,new THREE.MeshBasicMaterial()),m2=new THREE.Mesh(g2,new THREE.MeshBasicMaterial());
 const source=new THREE.Group();source.add(m1);source.add(m2);
 const p1=[0,1].map(id=>({id,url:`p1_${id}`,count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}));
 const p2=[0,1].map(id=>({id,url:`p2_${id}`,count:3,min:[2,-1,0],max:[4,1,0],bytes:12,sha256:'x'}));
 const metadata={primitives:[
  {mesh:0,primitive:0,pass:'exact-clusters' as const,pages:p1,hierarchy:{min:[-1,-1,0],max:[1,1,0],children:p1.map(p=>({min:p.min,max:p.max,page:p.id}))}},
  {mesh:1,primitive:0,pass:'exact-clusters' as const,pages:p2,hierarchy:{min:[2,-1,0],max:[4,1,0],children:p2.map(p=>({min:p.min,max:p.max,page:p.id}))}},
 ]};
 const indices=new Map([['p1_0',new Uint32Array([0,1,2])],['p1_1',new Uint32Array([0,2,3])],['p2_0',new Uint32Array([0,1,2])],['p2_1',new Uint32Array([0,2,3])]]);
 const associations=new Map([[m1,{meshes:0,primitives:0}],[m2,{meshes:1,primitives:0}]]);
 const backend=exactPagesBackend({source,metadata,indices,associations,maxResidentPages:10});
 const countMeshes=()=>{let n=0;backend.scene.traverse(o=>{if((o as THREE.Mesh).isMesh)n++;});return n;};
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=8;camera.lookAt(1,0,0);backend.render(camera);
 // 4 clusters visible across 2 primitives -> exactly 2 batched meshes (1 per primitive)
 assert.equal(backend.metrics().clusters,4);
 assert.equal(backend.metrics().residentPages,4);
 assert.equal(countMeshes(),2);
 // In clusters diagnostic mode -> 4 individual meshes for per-cluster coloring
 backend.setDiagnostic?.('clusters');
 assert.equal(countMeshes(),4);
 // Back to beauty mode -> back to 2 batched meshes
 backend.setDiagnostic?.('beauty');
 assert.equal(countMeshes(),2);
 backend.dispose();g1.dispose();g2.dispose();
});
test('exact pages keep replica meshes in separate batches despite shared glTF ids',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial();
 const m1=new THREE.Mesh(geometry,material),m2=new THREE.Mesh(geometry,material);
 m2.matrixAutoUpdate=false;m2.matrix.elements[12]=2;m2.updateMatrixWorld(true);
 const source=new THREE.Group();source.add(m1);source.add(m2);
 const pages=[0,1].map(id=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}));
 const backend=exactPagesBackend({source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy:{min:[-1,-1,0],max:[1,1,0],children:pages.map(p=>({min:p.min,max:p.max,page:p.id}))}}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])]]),associations:new Map([[m1,{meshes:0,primitives:0}],[m2,{meshes:0,primitives:0}]]),maxResidentPages:10});
 const meshes=()=>{const found:THREE.Mesh[]=[];backend.scene.traverse(o=>{if((o as THREE.Mesh).isMesh)found.push(o as THREE.Mesh);});return found;};
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=8;camera.lookAt(0,0,0);backend.render(camera);
 assert.equal(backend.metrics().clusters,4);
 assert.equal(meshes().length,2);
 const xs=meshes().map(mesh=>mesh.matrix.elements[12]).sort((a,b)=>a-b);
 assert.deepEqual(xs,[0,2]);
 backend.dispose();geometry.dispose();material.dispose();
});

