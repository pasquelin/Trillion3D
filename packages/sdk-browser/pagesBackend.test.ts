import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from 'three';
import {exactPagesBackend,referenceBackend} from './index.ts';
import {threeLodBackend} from './threeLod.ts';
import {collectClusterPages} from './pageSelection.ts';

/** Indices réellement dessinés par un objet, dans l'ordre de dessin : plages multi-draw ou tampon entier. */
function drawnIndices(mesh:THREE.Mesh){
 const index=mesh.geometry.getIndex();if(!index)return [];
 const batch=mesh as THREE.Mesh&{isBatchedMesh?:boolean;_multiDrawStarts?:Int32Array;_multiDrawCounts?:Int32Array;_multiDrawCount?:number};
 if(!batch.isBatchedMesh||!batch._multiDrawStarts)return Array.from(index.array);
 const out:number[]=[];
 for(let draw=0;draw<(batch._multiDrawCount??0);draw++){
  const first=batch._multiDrawStarts[draw]/Uint32Array.BYTES_PER_ELEMENT,length=batch._multiDrawCounts![draw];
  for(let i=first;i<first+length;i++)out.push(index.getX(i));
 }
 return out;
}
/** Triangles réellement soumis par la scène d'un backend. */
function drawnTriangles(scene:THREE.Object3D){
 let total=0;
 scene.traverse(object=>{if((object as THREE.Mesh).isMesh)total+=drawnIndices(object as THREE.Mesh).length/3;});
 return total;
}

type Cluster={id:number;url:string;count:number;min:number[];max:number[];bytes:number;sha256:string;role?:'exact'|'coarse'};
/** The screen-error band every cluster of a DAG cache carries, derived from its own box. */
function clusterSphere(page:{min:number[];max:number[]}){
 const c=[0,1,2].map(i=>(page.min[i]+page.max[i])/2);
 return [...c,Math.hypot(...[0,1,2].map(i=>page.max[i]-c[i]))||1];
}
/** Level-0 clusters nothing replaces: the smallest legal DAG, one root per cluster. */
function dagRoots(pages:Cluster[],starts?:number[]){
 return {pages:pages.map((page,index)=>({...page,role:'exact' as const,start:starts?.[index]??index*3,level:0,lodError:0,
  sphere:clusterSphere(page),parentError:null,parentSphere:null,group:null,source:null})),
  structure:{version:1,roots:pages.map((_,index)=>index),groups:[]}};
}
/** `leaves` replaced by `coarse` at screen error `error`: one group, one reduction. */
function dagLevel(leaves:Cluster[],coarse:Cluster[],error:number,roots:Cluster[]=[]){
 const sphere=clusterSphere(coarse[0]);
 const byId=(page:Cluster)=>page.id;
 return {
  pages:[
   ...leaves.map(page=>({...page,role:'exact' as const,start:page.start??page.id*3,level:0,lodError:0,
    sphere:clusterSphere(page),parentError:error,parentSphere:sphere,group:0,source:null})),
   ...coarse.map(page=>({...page,role:'coarse' as const,start:page.start??0,level:1,lodError:error,sphere,
    parentError:null,parentSphere:null,group:null,source:0})),
   ...roots.map(page=>({...page,role:'exact' as const,start:page.start??page.id*3,level:0,lodError:0,
    sphere:clusterSphere(page),parentError:null,parentSphere:null,group:null,source:null})),
  ].sort((a,b)=>a.id-b.id),
  structure:{version:1,roots:[...coarse,...roots].map(byId),groups:[{level:1,error,sphere,children:leaves.map(byId),outputs:coarse.map(byId)}]},
 };
}
const DAG={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups' as const};

test('transparent page batches preserve source order across exact and coarse cuts',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0,-1,0,0],3));geometry.setIndex([0,1,2,0,2,3,0,3,4]);
 const material=new THREE.MeshBasicMaterial({transparent:true,side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 // Clusters 0 and 1 are replaced together by the pair 3+4; cluster 2 is never replaced.
 const cluster=(id:number,start:number)=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x',start});
 const level=dagLevel([cluster(0,0),cluster(1,3)],[cluster(3,0),cluster(4,1)],0.001,[cluster(2,6)]);
 const context={source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'clustered-blend',...level}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])],['2',new Uint32Array([0,3,4])],['3',new Uint32Array([0,1,3])],['4',new Uint32Array([1,2,3])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),pixelError:0,viewport:[960,540] as [number,number]};
 const backend=exactPagesBackend(context);
 const meshes=()=>backend.scene.children.filter(object=>(object as THREE.Mesh).isMesh) as THREE.Mesh[];
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);backend.render(camera);
 assert.equal(meshes().length,1);
 // Transparent double face : les deux passes que Three.js improviserait à chaque image sont figées en
 // deux matériaux dos/face issus du matériau source, et deux groupes de géométrie les ordonnent.
 const split=meshes()[0].material as THREE.Material[];
 assert.ok(Array.isArray(split));
 assert.deepEqual([split[0].side,split[1].side],[THREE.BackSide,THREE.FrontSide]);
 assert.deepEqual(split.map(one=>(one as THREE.MeshBasicMaterial).color.getHex()),[material.color.getHex(),material.color.getHex()]);
 assert.deepEqual(meshes()[0].geometry.groups.map(group=>group.materialIndex),[0,1]);
 assert.deepEqual(drawnIndices(meshes()[0]),[0,1,2,0,2,3,0,3,4]);
 context.pixelError=10;backend.render(camera);
 assert.equal(meshes().length,1);
 assert.deepEqual(drawnIndices(meshes()[0]),[0,1,3,1,2,3,0,3,4]);
 backend.dispose();geometry.dispose();material.dispose();
});
test('exact pages report measured residency and keep only the visible set in the scene',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[0,1].map(id=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}));
 const backend=exactPagesBackend({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...dagRoots(pages)}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),maxResidentPages:2});
 const meshes=()=>{const found:THREE.Mesh[]=[];backend.scene.traverse(o=>{if((o as THREE.Mesh).isMesh)found.push(o as THREE.Mesh);});return found;};
 assert.equal(meshes().length,0);
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);backend.render(camera);
 assert.equal(backend.metrics().clusters,2);assert.equal(backend.metrics().selectedTriangles,2);assert.equal(backend.metrics().residentPages,2);assert.equal(backend.metrics().geometryAllocationBytes,12*4+2*3*4);assert.equal(meshes().length,1);assert.equal(backend.metrics().drawCalls,1);
 backend.setDiagnostic?.('pages');assert.equal(meshes().length,2);backend.setDiagnostic?.('beauty');assert.equal(meshes().length,1);
 camera.lookAt(0,0,10);backend.render(camera);assert.equal(backend.metrics().clusters,0);assert.equal(backend.metrics().selectedTriangles,0);assert.equal(backend.metrics().residentPages,0);assert.equal(meshes().length,0);
 backend.dispose();geometry.dispose();material.dispose();
});

test('source instance transforms update all three WebGL backends without rebuilding pages',()=>{
 for(const factory of [referenceBackend,exactPagesBackend,threeLodBackend]){
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,0,1,0],3));geometry.setIndex([0,1,2]);
  const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
  const page={id:0,url:'0',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'};
  const backend=factory({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...dagRoots([page])}]},indices:new Map([['0',new Uint32Array([0,1,2])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]])});
  const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
  backend.render(camera);mesh.position.x=100;backend.render(camera);
  if(backend.id==='exact-cluster-pages')assert.equal(backend.metrics().selectedTriangles,0);
  else{const object=backend.scene.children.find(child=>child.type==='Mesh'||child.type==='LOD');assert.ok(object);assert.equal(object.matrix.elements[12],100);}
  backend.dispose();geometry.dispose();material.dispose();
 }
});
test('a cut over the resident budget raises the flag and still covers the surface once',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[0,1].map(id=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}));
 const backend=exactPagesBackend({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...dagRoots(pages)}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),maxResidentPages:1});
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
 backend.render(camera);
 // A DAG cut is a partition: truncating it would punch a hole, so the cover stays whole and only
 // the flag is raised. Both clusters are still drawn, in one batch.
 assert.equal(backend.overBudget,true);
 let meshCount=0;backend.scene.traverse(o=>{if((o as THREE.Mesh).isMesh)meshCount++;});assert.equal(meshCount,1);
 assert.equal(backend.metrics().residentPages,2);
 backend.dispose();geometry.dispose();material.dispose();
});
test('exact pages select coarse LOD when the screen error is under the pixel threshold',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const cluster=(id:number)=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'});
 // Two clusters replaced by one coarser cluster whose screen error clears a 10 px budget.
 const level=dagLevel([cluster(0),cluster(1)],[cluster(2)],0.001);
 const backend=exactPagesBackend({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...level}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])],['2',new Uint32Array([0,1,2])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),pixelError:10,viewport:[960,540]});
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);backend.render(camera);
 assert.equal(backend.metrics().clusters,1);assert.equal(backend.metrics().selectedTriangles,1);assert.equal(backend.metrics().lodLevel,1);
 backend.dispose();geometry.dispose();material.dispose();
});
test('pixelError is read from the context each frame',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const cluster=(id:number)=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'});
 // Two clusters replaced by one coarser cluster whose screen error clears a 10 px budget.
 const level=dagLevel([cluster(0),cluster(1)],[cluster(2)],0.001);
 const context={source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...level}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])],['2',new Uint32Array([0,1,2])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),pixelError:0,viewport:[960,540] as [number,number]};
 const backend=exactPagesBackend(context);
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
 backend.render(camera);assert.equal(backend.metrics().clusters,2);
 context.pixelError=10;backend.render(camera);assert.equal(backend.metrics().clusters,1);
 backend.dispose();geometry.dispose();material.dispose();
});
test('a three-level DAG picks the middle reduction and skips the one above it',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 // Three levels: clusters 0+1 reduce to 2, which reduces to 3. At 10 px only the middle level fits.
 const cluster=(id:number)=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'});
 const mid=0.001,top=1e6,sphere=clusterSphere(cluster(2));
 const pages=[
  ...[0,1].map(id=>({...cluster(id),role:'exact' as const,start:id*3,level:0,lodError:0,sphere:clusterSphere(cluster(id)),parentError:mid,parentSphere:sphere,group:0,source:null})),
  {...cluster(2),role:'coarse' as const,start:0,level:1,lodError:mid,sphere,parentError:top,parentSphere:sphere,group:1,source:0},
  {...cluster(3),role:'coarse' as const,start:0,level:2,lodError:top,sphere,parentError:null,parentSphere:null,group:null,source:1},
 ];
 const structure={version:1,roots:[3],groups:[
  {level:1,error:mid,sphere,children:[0,1],outputs:[2]},
  {level:2,error:top,sphere,children:[2],outputs:[3]},
 ]};
 const backend=exactPagesBackend({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,structure}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])],['2',new Uint32Array([0,1,2])],['3',new Uint32Array([0,2,3])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),pixelError:10,viewport:[960,540]});
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);backend.render(camera);
 assert.equal(backend.metrics().clusters,1);assert.equal(backend.metrics().selectedTriangles,1);assert.equal(backend.metrics().lodLevel,1);
 backend.dispose();geometry.dispose();material.dispose();
});
test('exact pages attach accepted pages in the same frame without a second frustum walk',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[0,1].map(id=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}));
 const backend=exactPagesBackend({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...dagRoots(pages)}]},indices:new Map(),associations:new Map([[mesh,{meshes:0,primitives:0}]]),maxResidentPages:2});
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
 const backend=exactPagesBackend({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...dagRoots(pages)}]},indices:new Map(),associations:new Map([[mesh,{meshes:0,primitives:0}]]),maxResidentPages:2});
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
test('a primitive whose clusters are all roots selects every one of them',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[0,1].map(id=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}));
 const backend=exactPagesBackend({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...dagRoots(pages)}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),maxResidentPages:2});
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);backend.render(camera);
 assert.equal(backend.metrics().clusters,2);assert.equal(backend.metrics().residentPages,2);assert.equal(backend.metrics().selectedTriangles,2);
 backend.dispose();geometry.dispose();material.dispose();
});
test('page bounding sphere uses the page AABB, not the shared source mesh',()=>{
 const positions=new Float32Array(300);positions.set([-1000,-1000,-1000,1000,-1000,-1000,1000,1000,-1000],0);positions.set([-1,-1,0,1,-1,0,1,1,0],9);
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex([3,4,5]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[{id:0,url:'0',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}];
 const backend=exactPagesBackend({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...dagRoots(pages)}]},indices:new Map([['0',new Uint32Array([3,4,5])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]])});
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
 const metadata={...DAG,primitives:[
  {mesh:0,primitive:0,pass:'exact-clusters' as const,...dagRoots(p1)},
  {mesh:1,primitive:0,pass:'exact-clusters' as const,...dagRoots(p2)},
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
 const backend=exactPagesBackend({source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...dagRoots(pages)}]},indices:new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])]]),associations:new Map([[m1,{meshes:0,primitives:0}],[m2,{meshes:0,primitives:0}]]),maxResidentPages:10});
 const meshes=()=>{const found:THREE.Mesh[]=[];backend.scene.traverse(o=>{if((o as THREE.Mesh).isMesh)found.push(o as THREE.Mesh);});return found;};
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=8;camera.lookAt(0,0,0);backend.render(camera);
 assert.equal(backend.metrics().clusters,4);
 assert.equal(meshes().length,2);
 const xs=meshes().map(mesh=>mesh.matrix.elements[12]).sort((a,b)=>a-b);
 assert.deepEqual(xs,[0,2]);
 backend.dispose();geometry.dispose();material.dispose();
});
test('a missing replacement keeps the resident coarse cover rather than leaving a hole',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const cluster=(id:number)=>({id,url:String(id),count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'});
 // Two clusters replaced by one coarser cluster whose screen error clears a 10 px budget.
 const level=dagLevel([cluster(0),cluster(1)],[cluster(2)],0.001);
 const context={source,metadata:{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...level}]},indices:new Map(),associations:new Map([[mesh,{meshes:0,primitives:0}]]),pixelError:0,viewport:[960,540] as [number,number]};
 const backend=exactPagesBackend(context);
 const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
 // The pinned root cluster is the only one resident: it covers the frame on its own.
 backend.acceptPage?.('2',new Uint32Array([0,1,2]));
 backend.render(camera);
 const triangles=()=>drawnTriangles(backend.scene);
 assert.equal(triangles(),1);
 assert.deepEqual(backend.pendingUrls?.().sort(),['0','1'],'the finer cut is what the streamer is asked for');
 assert.equal(backend.overBudget,false);
 assert.equal(backend.metrics().selectedTriangles,2,'the wanted cut is the fine one');
 assert.equal(backend.metrics().submittedTriangles,1,'what is drawn is the resident coarse cover');
 // One of the two replacements alone cannot replace the cover: a half swap would leave a hole.
 backend.acceptPage?.('0',new Uint32Array([0,1,2]));backend.render(camera);
 assert.equal(triangles(),1);
 backend.acceptPage?.('1',new Uint32Array([0,2,3]));backend.render(camera);
 assert.equal(triangles(),2);
 backend.dispose();geometry.dispose();material.dispose();
});
test('transmissive materials stay as unsplit source meshes even when the cache pass is exact-clusters',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0],3));geometry.setIndex([0,1,2]);
 const material=new THREE.MeshPhysicalMaterial({transmission:1,thickness:0.02,roughness:0});
 const mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[{id:0,url:'0',count:3,min:[-1,-1,0],max:[1,1,0],bytes:12,sha256:'x'}];
 const collected=collectClusterPages(source,{...DAG,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...dagRoots(pages)}]},new Map([['0',new Uint32Array([0,1,2])]]),new Map([[mesh,{meshes:0,primitives:0}]]));
 assert.equal(collected.allPages.length,0);
 assert.equal(collected.blendCopies.length,1);
 assert.equal(collected.blendCopies[0].material,material);
 geometry.dispose();material.dispose();
});
