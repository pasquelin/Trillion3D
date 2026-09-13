import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from 'three';
import {threeLodBackend} from './threeLod.ts';

type Cluster={id:number;url:string;count:number;min:number[];max:number[];bytes:number;sha256:string;start?:number};
const DAG={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups' as const};
function clusterSphere(page:{min:number[];max:number[]}){
 const c=[0,1,2].map(i=>(page.min[i]+page.max[i])/2);
 return [...c,Math.hypot(...[0,1,2].map(i=>page.max[i]-c[i]))||1];
}
/** `leaves` replaced by `coarse`, plus clusters nothing replaces: the DAG THREE.LOD reads. */
function dag(leaves:Cluster[],coarse:Cluster[],roots:Cluster[]=[],error=1){
 const sphere=coarse.length?clusterSphere(coarse[0]):[0,0,0,1];
 const byId=(page:Cluster)=>page.id;
 return {pages:[
  ...leaves.map(page=>({...page,role:'exact' as const,start:page.start??page.id*3,level:0,lodError:0,sphere:clusterSphere(page),parentError:error,parentSphere:sphere,group:0,source:null})),
  ...coarse.map(page=>({...page,role:'coarse' as const,start:page.start??0,level:1,lodError:error,sphere,parentError:null,parentSphere:null,group:null,source:0})),
  ...roots.map(page=>({...page,role:'exact' as const,start:page.start??page.id*3,level:0,lodError:0,sphere:clusterSphere(page),parentError:null,parentSphere:null,group:null,source:null})),
 ].sort((a,b)=>a.id-b.id),
 structure:{version:1,roots:[...coarse,...roots].map(byId),groups:coarse.length?[{level:1,error,sphere,children:leaves.map(byId),outputs:coarse.map(byId)}]:[]}};
}
test('THREE.LOD includes transparent simplification and merges its mixed cover in source order',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0,-1,0,0],3));geometry.setIndex([0,1,2,0,2,3,0,3,4]);
 const material=new THREE.MeshBasicMaterial({transparent:true,side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 // Clusters 0 and 1 reduce to 3; cluster 2 is never replaced, so the cover is {3, 2} in source order.
 const cluster=(id:number,start:number)=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',start});
 const primitive=dag([cluster(0,0),cluster(1,3)],[cluster(3,0)],[cluster(2,6)]);
 const backend=threeLodBackend({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'clustered-blend',...primitive}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])],['2',new Uint32Array([0,3,4])],['3',new Uint32Array([0,1,3])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]])});
 const lod=backend.scene.children.find(o=>(o as THREE.LOD).isLOD) as THREE.LOD;
 assert.equal(lod.levels.length,2);
 assert.equal(backend.capabilities.simplification,true);
 const coarse=lod.levels[1].object as THREE.Mesh;
 assert.equal(coarse.material,material);
 assert.deepEqual(Array.from(coarse.geometry.index!.array),[0,1,3,0,3,4]);
 backend.dispose();geometry.dispose();material.dispose();
});
test('THREE.LOD keeps one exact level for source-ordered transparent pages',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,0,1,0],3));geometry.setIndex([0,1,2]);
 const material=new THREE.MeshBasicMaterial({transparent:true}),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const primitive=dag([],[],[{id:0,url:'0',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}]);
 const backend=threeLodBackend({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'clustered-blend',...primitive}]},indices:new Map([['0',new Uint32Array([0,1,2])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]])});
 const lod=backend.scene.children.find(o=>(o as THREE.LOD).isLOD) as THREE.LOD;
 assert.equal(lod.levels.length,1);
 assert.equal(backend.capabilities.simplification,false);
 backend.dispose();geometry.dispose();material.dispose();
});
test('THREE.LOD backend exposes one level without coarse pages and two with them',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
 const none=threeLodBackend({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages:[]}]},indices:new Map(),associations:new Map([[mesh,{meshes:0,primitives:0}]])});
 none.render(camera);
 assert.equal(none.capabilities.simplification,false);
 assert.equal(none.metrics().clusters,1);
 none.dispose();
 const cluster=(id:number)=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'});
 const reduced=dag([cluster(0)],[cluster(1)]);
 const withLod=threeLodBackend({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...reduced}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]])});
 withLod.render(camera);
 assert.equal(withLod.capabilities.simplification,true);
 assert.ok((withLod.metrics().selectedTriangles??0)>0);
 withLod.dispose();geometry.dispose();material.dispose();
});
test('a far THREE.LOD level keeps the clusters that nothing replaces',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 // Cluster 0 reduces to 2; cluster 1 is never replaced, so the far level is {2, 1}.
 const cluster=(id:number)=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'});
 const primitive=dag([cluster(0)],[cluster(2)],[cluster(1)]);
 const backend=threeLodBackend({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...primitive}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])],['2',new Uint32Array([0,1,2])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]])});
 const lod=backend.scene.children.find(o=>(o as THREE.LOD).isLOD) as THREE.LOD;
 assert.ok(lod);
 assert.equal(lod.levels.length,2);
 assert.deepEqual(Array.from((lod.levels[0].object as THREE.Mesh).geometry.index!.array),[0,1,2,0,2,3]);
 // The far level is the cover in cluster order: the unreplaced cluster 1, then the reduction 2.
 assert.deepEqual(Array.from((lod.levels[1].object as THREE.Mesh).geometry.index!.array),[0,2,3,0,1,2]);
 backend.dispose();geometry.dispose();material.dispose();
});
