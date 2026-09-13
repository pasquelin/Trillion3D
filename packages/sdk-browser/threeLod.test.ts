import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from 'three';
import {threeLodBackend} from './threeLod.ts';
test('THREE.LOD backend exposes one level without coarse pages and two with them',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
 const none=threeLodBackend({source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages:[],hierarchy:null}]},indices:new Map(),associations:new Map([[mesh,{meshes:0,primitives:0}]])});
 none.render(camera);
 assert.equal(none.capabilities.simplification,false);
 assert.equal(none.metrics().clusters,1);
 none.dispose();
 const pages=[{id:0,url:'0',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'exact' as const},{id:1,url:'1',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'coarse' as const}];
 const withLod=threeLodBackend({source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy:{min:[-1,-1,0],max:[1,1,0],errorObject:1,coarsePages:[1],children:[{min:[-1,-1,0],max:[1,1,0],page:0}]}}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]])});
 withLod.render(camera);
 assert.equal(withLod.capabilities.simplification,true);
 assert.ok((withLod.metrics().selectedTriangles??0)>0);
 withLod.dispose();geometry.dispose();material.dispose();
});
test('a far THREE.LOD level keeps exact leaves of branches without a coarse page',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[
  {id:0,url:'0',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'exact' as const},
  {id:1,url:'1',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'exact' as const},
  {id:2,url:'2',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',role:'coarse' as const},
 ];
 const hierarchy={min:[-1,-1,0],max:[1,1,0],children:[
  {min:[-1,-1,0],max:[1,1,0],errorObject:0,coarsePages:[2],children:[{min:[-1,-1,0],max:[1,1,0],page:0}]},
  {min:[-1,-1,0],max:[1,1,0],page:1},
 ]};
 const backend=threeLodBackend({source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])],['2',new Uint32Array([0,1,2])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]])});
 const lod=backend.scene.children.find(o=>(o as THREE.LOD).isLOD) as THREE.LOD;
 assert.ok(lod);
 assert.equal(lod.levels.length,2);
 assert.deepEqual(Array.from((lod.levels[0].object as THREE.Mesh).geometry.index!.array),[0,1,2,0,2,3]);
 assert.deepEqual(Array.from((lod.levels[1].object as THREE.Mesh).geometry.index!.array),[0,1,2,0,2,3]);
 backend.dispose();geometry.dispose();material.dispose();
});
