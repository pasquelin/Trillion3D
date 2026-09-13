import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {clusterErrorPixels,maxStretch,type ClusterManifest} from '../sdk-core/index.ts';
import {collectClusterPages,selectVisiblePages} from './pageSelection.ts';
import {cameraSelectionUniforms} from './gpuSelection.ts';
import {evaluateDagSelectionKernel,packDagSelection,rootsAreFlat,DAG_SELECTION_SHADER} from './gpuDagSelection.ts';

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
 const indices=new Map<string,Uint32Array>(pages.map(page=>[page.url,new Uint32Array([0,1,2])]));
 for(let id=0;id<4;id++)indices.set(`leaf${id}`,new Uint32Array([id*3,id*3+1,id*3+2]));
 return {geometry,mesh,source,metadata,indices,associations:new Map([[mesh,{meshes:0,primitives:0}]])};
}
/** Hand-built hierarchy over the fixture: leaves in one child, coarse levels in the other. */
function dagCulling(){
 const both=[0,0,0,2.2],rootSphere=[0,0,0,2.3],whole=[-2,-.5,0,2,.5,0];
 const node=(box:number[],sphere:number[],maxParent:number,firstChild:number,childCount:number,firstPage:number,pageCount:number)=>
  [...box,...sphere,maxParent,firstChild,childCount,firstPage,pageCount];
 return {stride:15,count:3,nodes:[
  ...node(whole,rootSphere,-1,1,2,0,0),
  ...node(whole,both,.02,0,0,0,4),
  ...node(whole,rootSphere,-1,0,0,4,3),
 ]};
}
const VIEWPORT:[number,number]=[1280,720];
function wideCamera(){const cam=new THREE.PerspectiveCamera(55,16/9,.1,1000);cam.position.set(0,0,5);cam.lookAt(0,0,0);cam.updateMatrixWorld();return cam;}
function packed(fixture:ReturnType<typeof dagFixture>){
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 assert.ok(rootsAreFlat(roots),'the fixture must produce a flat cut');
 return {roots,dag:packDagSelection(roots)};
}
function kernelUrls(fixture:ReturnType<typeof dagFixture>,pixelError:number,cam:THREE.PerspectiveCamera,resident?:Uint32Array,field:'pageIds'|'drawablePageIds'='pageIds'){
 const {dag}=packed(fixture);
 const result=evaluateDagSelectionKernel(dag,cameraSelectionUniforms(cam,pixelError,VIEWPORT),resident);
 return {result,urls:(result[field]??[]).map(id=>dag.pageUrls[id]).sort()};
}
function cpuUrls(fixture:ReturnType<typeof dagFixture>,pixelError:number,cam:THREE.PerspectiveCamera){
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 return selectVisiblePages(roots,cam,{pixelError,viewport:VIEWPORT,frame:1}).shown.map(page=>page.url).sort();
}

test('the kernel projects a cluster error exactly like clusterErrorPixels',()=>{
 // The WGSL band test is `error x stretch x focal / distance`, with Infinity at the near plane.
 // Replaying it against the published oracle keeps the GPU and CPU cuts on one formula.
 const cam=wideCamera();
 const uniforms=cameraSelectionUniforms(cam,1,VIEWPORT);
 const focal=Math.max(uniforms.pixelScale[0],uniforms.pixelScale[1]);
 const world=new THREE.Matrix4().makeRotationY(.7).setPosition(1,-2,3);
 const view=new THREE.Matrix4().multiplyMatrices(cam.matrixWorldInverse,world),e=view.elements;
 const stretch=maxStretch(world.elements)*(uniforms.cameraStretch as number);
 assert.ok(Number.isFinite(stretch)&&stretch>0);
 for(const [cx,cy,cz,radius,error] of [[0,0,0,.6,.02],[3,-1,2,1.2,.5],[-4,2,-6,.1,7],[0,0,4.9,.05,1],[0,0,0,.6,0]] as const){
  const vx=e[0]*cx+e[4]*cy+e[8]*cz+e[12],vy=e[1]*cx+e[5]*cy+e[9]*cz+e[13],vz=e[2]*cx+e[6]*cy+e[10]*cz+e[14];
  const expected=clusterErrorPixels(error,stretch,vx,vy,vz,radius,focal,cam.near);
  const distance=Math.sqrt(vx*vx+vy*vy+vz*vz)-radius*stretch;
  const kernel=error===0?0:distance>cam.near?(error*stretch*focal)/distance:Infinity;
  assert.equal(kernel,expected,`error ${error} radius ${radius}`);
 }
 // The shader carries the same three terms, in the same order.
 assert.match(DAG_SELECTION_SHADER,/let distance=length\(v\)-sphere\.w\*stretch;/);
 assert.match(DAG_SELECTION_SHADER,/return \(error\*stretch\*focal\)\/distance;/);
});

test('the GPU flat cut selects the same single cluster per chain as the CPU cut',()=>{
 const plain=dagFixture(),accelerated=dagFixture();
 accelerated.metadata.primitives[0].culling=dagCulling();
 const cam=wideCamera();
 const chains=[['leaf0','mid-left','root'],['leaf1','mid-left','root'],['leaf2','mid-right','root'],['leaf3','mid-right','root']];
 for(const pixelError of [0,1,3.4,3.6,20,60,200,1e6]){
  const cpu=cpuUrls(plain,pixelError,cam);
  assert.deepEqual(kernelUrls(plain,pixelError,cam).urls,cpu,`pixelError ${pixelError}`);
  // The culling hierarchy is only an early reject: it must not change the selected set.
  assert.deepEqual(kernelUrls(accelerated,pixelError,cam).urls,cpu,`accelerated pixelError ${pixelError}`);
  const shown=new Set(cpu);
  for(const chain of chains)assert.equal(chain.filter(url=>shown.has(url)).length,1,`pixelError ${pixelError}: ${chain.join('>')}`);
 }
 plain.geometry.dispose();accelerated.geometry.dispose();
});

test('a cut with nothing resident but the roots publishes the root cover',()=>{
 const fixture=dagFixture();
 const {dag}=packed(fixture);
 const resident=Uint32Array.from(dag.pageUrls.map(url=>url==='root'?1:0));
 const result=evaluateDagSelectionKernel(dag,cameraSelectionUniforms(wideCamera(),0,VIEWPORT),resident);
 assert.deepEqual((result.drawablePageIds??[]).map(id=>dag.pageUrls[id]),['root']);
 assert.equal(result.complete,true,'the pinned root cover must leave no hole');
 // The wanted list still reports the detail the streamer has to fetch.
 assert.deepEqual((result.pageIds??[]).map(id=>dag.pageUrls[id]).sort(),['leaf0','leaf1','leaf2','leaf3']);
 fixture.geometry.dispose();
});

test('a missing cluster is replaced by its nearest resident ancestor, not by the root',()=>{
 const fixture=dagFixture();
 const {dag}=packed(fixture);
 // Every cluster is resident except one leaf: its group replacement covers the gap on its own.
 const resident=Uint32Array.from(dag.pageUrls.map(url=>url==='leaf0'?0:1));
 const result=evaluateDagSelectionKernel(dag,cameraSelectionUniforms(wideCamera(),0,VIEWPORT),resident);
 const drawn=(result.drawablePageIds??[]).map(id=>dag.pageUrls[id]).sort();
 assert.deepEqual(drawn,['mid-left','mid-right']);
 assert.equal(result.complete,true);
 assert.ok(!drawn.includes('root'),'the pinned cover is the last resort, not the first');
 fixture.geometry.dispose();
});
