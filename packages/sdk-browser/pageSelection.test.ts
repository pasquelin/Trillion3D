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

/** Four source triangles in a row, replaced by two mid clusters, then by one root. */
function dagFixture(){
 const positions:number[]=[];
 for(let t=0;t<4;t++){const x=-2+t;positions.push(x,-.5,0,x+1,-.5,0,x+.5,.5,0);}
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setIndex([...Array(12).keys()]);
 const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
 const source=new THREE.Group();source.add(mesh);
 const leftSphere=[-1,0,0,1.2],rightSphere=[1,0,0,1.2],rootSphere=[0,0,0,2.3];
 const midError=.02,rootError=.2;
 const leaf=(id:number)=>({id,url:`leaf${id}`,sha256:`leaf${id}`,bytes:12,count:3,
  min:[-2+id,-.5,0],max:[-1+id,.5,0],role:'exact' as const,level:0,lodError:0,
  sphere:[-1.5+id,0,0,.6],parentError:midError,parentSphere:id<2?leftSphere:rightSphere});
 const pages=[
  leaf(0),leaf(1),leaf(2),leaf(3),
  {id:4,url:'mid-left',sha256:'mid-left',bytes:12,count:3,min:[-2,-.5,0],max:[0,.5,0],role:'coarse' as const,level:1,lodError:midError,sphere:leftSphere,parentError:rootError,parentSphere:rootSphere},
  {id:5,url:'mid-right',sha256:'mid-right',bytes:12,count:3,min:[0,-.5,0],max:[2,.5,0],role:'coarse' as const,level:1,lodError:midError,sphere:rightSphere,parentError:rootError,parentSphere:rootSphere},
  {id:6,url:'root',sha256:'root',bytes:12,count:3,min:[-2,-.5,0],max:[2,.5,0],role:'coarse' as const,level:2,lodError:rootError,sphere:rootSphere,parentError:null,parentSphere:null},
 ];
 const metadata={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups',primitives:[{mesh:0,primitive:0,pass:'exact-clusters',clusterStrategy:'dag-groups' as const,pages,hierarchy:null}]} as unknown as ClusterManifest;
 const indices=new Map(pages.map(page=>[page.url,new Uint32Array([0,1,2])]));
 for(let id=0;id<4;id++)indices.set(`leaf${id}`,new Uint32Array([id*3,id*3+1,id*3+2]));
 return {geometry,mesh,source,metadata,indices,associations:new Map([[mesh,{meshes:0,primitives:0}]])};
}
function wideCamera(){const cam=new THREE.PerspectiveCamera(55,16/9,.1,1000);cam.position.set(0,0,5);cam.lookAt(0,0,0);cam.updateMatrixWorld();return cam;}
function urls(fixture:ReturnType<typeof dagFixture>,pixelError:number,cam=wideCamera()){
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 return selectVisiblePages(roots,cam,{pixelError,viewport:[1280,720],frame:1,holdResident:true}).shown.map(page=>page.url).sort();
}

test('a flat cluster cut selects exactly one level per chain and covers the surface once',()=>{
 const fixture=dagFixture();
 assert.deepEqual(urls(fixture,0),['leaf0','leaf1','leaf2','leaf3']);
 assert.deepEqual(urls(fixture,8),['mid-left','mid-right']);
 assert.deepEqual(urls(fixture,200),['root']);
 // Every threshold keeps exactly one cluster of each leaf-to-root chain.
 const chains=[['leaf0','mid-left','root'],['leaf1','mid-left','root'],['leaf2','mid-right','root'],['leaf3','mid-right','root']];
 for(const pixelError of [0,1,4,7.4,7.6,20,138,139,1e6]){
  const shown=new Set(urls(fixture,pixelError));
  for(const chain of chains)assert.equal(chain.filter(url=>shown.has(url)).length,1,`pixelError ${pixelError}: ${chain.join('>')}`);
 }
 fixture.geometry.dispose();
});

test('a flat cluster cut keeps the frustum cut and reports the root cover',()=>{
 const fixture=dagFixture();
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 assert.deepEqual(rootCoverage(roots).map(page=>page.url),['root']);
 const cam=new THREE.PerspectiveCamera(40,1,.1,1000);cam.position.set(-1.5,0,2);cam.lookAt(-1.5,0,0);cam.updateMatrixWorld();
 const selected=selectVisiblePages(roots,cam,{pixelError:0,viewport:[1280,720],frame:1,holdResident:true});
 assert.deepEqual(selected.shown.map(page=>page.url).sort(),['leaf0','leaf1']);
 assert.ok(selected.frustumRejected>0);
 fixture.geometry.dispose();
});

test('a flat cut reports an incomplete cover while a selected cluster is still loading',()=>{
 const fixture=dagFixture();fixture.indices.delete('leaf0');
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations,{allowMissing:true});
 const selected=selectVisiblePages(roots,wideCamera(),{pixelError:0,viewport:[1280,720],frame:1,holdResident:true});
 assert.equal(selected.complete,false);
 assert.deepEqual(selected.wanted.map(page=>page.url).sort(),['leaf0','leaf1','leaf2','leaf3']);
 assert.deepEqual(selected.shown.map(page=>page.url).sort(),['leaf1','leaf2','leaf3']);
 fixture.geometry.dispose();
});

test('a page whose replacement error sits below its own error is rejected at load time',()=>{
 const fixture=dagFixture();
 fixture.metadata.primitives[0].pages[4].parentError=0.001;
 assert.throws(()=>collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations),/parentError sous lodError/);
 fixture.metadata.primitives[0].pages[4].parentError=0.2;
 fixture.metadata.primitives[0].pages[4].parentSphere=null;
 assert.throws(()=>collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations),/parentError sans parentSphere/);
 fixture.geometry.dispose();
});

/** Hand-built hierarchy over the fixture: leaves in one child, coarse levels in the other. */
function dagCulling(){
 const left=[-1,0,0,1.2],right=[1,0,0,1.2],rootSphere=[0,0,0,2.3];
 const both=[0,0,0,2.2];
 const whole=[-2,-.5,0,2,.5,0];
 const node=(box:number[],sphere:number[],maxParent:number,firstChild:number,childCount:number,firstPage:number,pageCount:number)=>
  [...box,...sphere,maxParent,firstChild,childCount,firstPage,pageCount];
 return {stride:15,count:3,nodes:[
  ...node(whole,rootSphere,-1,1,2,0,0),
  ...node(whole,both,.02,0,0,0,4),
  ...node(whole,rootSphere,-1,0,0,4,3),
 ]};
}

test('the culling hierarchy accelerates the flat cut without changing it',()=>{
 const plain=dagFixture(),accelerated=dagFixture();
 accelerated.metadata.primitives[0].culling=dagCulling();
 const cam=wideCamera();
 for(const pixelError of [0,1,3.4,3.6,20,60,200,1e6]){
  const a=urls(plain,pixelError,cam),b=urls(accelerated,pixelError,cam);
  assert.deepEqual(b,a,`pixelError ${pixelError}`);
 }
 // The leaf subtree must actually be skipped once its replacement error fits the budget.
 const {roots}=collectClusterPages(accelerated.source,accelerated.metadata,accelerated.indices,accelerated.associations);
 assert.ok(roots[0].culling,'the hierarchy must be unpacked');
 const coarse=selectVisiblePages(roots,cam,{pixelError:20,viewport:[1280,720],frame:1});
 assert.deepEqual(coarse.shown.map(page=>page.url).sort(),['mid-left','mid-right']);
 plain.geometry.dispose();accelerated.geometry.dispose();
});

test('a culling hierarchy that does not match its pages is rejected',()=>{
 const fixture=dagFixture();
 const broken=dagCulling();broken.nodes[15+13]=99; // the leaf child now claims pages past the end
 fixture.metadata.primitives[0].culling=broken;
 assert.throws(()=>collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations),/culling/i);
 const short=dagCulling();short.count=4;
 fixture.metadata.primitives[0].culling=short;
 assert.throws(()=>collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations),/culling/i);
 fixture.geometry.dispose();
});

test('transparent flat pages keep a draw order taken from their source rank',()=>{
 const fixture=dagFixture();
 fixture.mesh.material=new THREE.MeshBasicMaterial({transparent:true});
 for(const page of fixture.metadata.primitives[0].pages)page.start=(6-page.id)*3;
 const {allPages}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 assert.deepEqual(allPages.map(page=>page.sourceOrder),[18,15,12,9,6,3,0]);
 fixture.geometry.dispose();
});
