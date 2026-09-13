import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {clusterErrorPixels,maxStretch,type ClusterManifest} from '../sdk-core/index.ts';
import {collectClusterPages,selectVisiblePages} from './pageSelection.ts';
import {cameraSelectionUniforms} from './gpuSelection.ts';
import {createGpuDagSelection,evaluateDagSelectionKernel,packDagSelection,DAG_SELECTION_SHADER,type PackedDag} from './gpuDagSelection.ts';

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
 const structure={version:1,roots:[6],groups:[
  {level:1,error:midError,sphere:leftSphere,children:[0,1],outputs:[4]},
  {level:1,error:midError,sphere:rightSphere,children:[2,3],outputs:[5]},
  {level:2,error:rootError,sphere:rootSphere,children:[4,5],outputs:[6]},
 ]};
 const metadata={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups',primitives:[{mesh:0,primitive:0,pass:'exact-clusters',clusterStrategy:'dag-groups' as const,pages,structure}]} as unknown as ClusterManifest;
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

function installGpuGlobals(){
 Object.assign(globalThis,{
  GPUBufferUsage:{MAP_READ:1,MAP_WRITE:2,COPY_SRC:4,COPY_DST:8,INDEX:16,VERTEX:32,UNIFORM:64,STORAGE:128,INDIRECT:256,QUERY_RESOLVE:512},
  GPUShaderStage:{VERTEX:1,FRAGMENT:2,COMPUTE:4},
  GPUMapMode:{READ:1,WRITE:2},
 });
}

/** Replays the WGSL kernel on the CPU behind a WebGPU device shape, so the buffer plumbing —
 *  uniform writes, the readback ring, the drawable mask — is exercised without a real adapter. */
function mockDagDevice(packed:PackedDag,options:{failMap?:boolean;mapGate?:Promise<void>}={}){
 type Buf={size:number;usage:number;data:Uint8Array};
 let bind:{entries:Array<{binding:number;resource:{buffer:Buf}}>}|undefined;
 let pipeline:{entryPoint:string}|undefined,uniformWriteCount=0;
 const readUniforms=(data:Uint8Array)=>{
  const f32=new Float32Array(data.buffer,data.byteOffset,data.byteLength/4);
  const u32=new Uint32Array(data.buffer,data.byteOffset,data.byteLength/4);
  return {uniforms:{planes:f32.slice(0,24),view:f32.slice(24,40),pixelScale:[f32[40],f32[41]] as [number,number],
   pixelError:f32[42],near:f32[43],cameraWorld:[f32[48],f32[49],f32[50]] as [number,number,number],cameraStretch:f32[51]},residentCut:!!u32[47]};
 };
 const device={
  limits:{maxBufferSize:1<<20,maxStorageBufferBindingSize:1<<20},
  createBuffer:({size,usage}:{size:number;usage:number})=>({size,usage,data:new Uint8Array(size),destroy(){},
   mapAsync:async function(this:Buf){if(options.failMap)throw new Error('MAP_FAILED');await options.mapGate;},
   getMappedRange:function(this:Buf){return this.data.buffer;},unmap(){}}),
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
  createBindGroupLayout:()=>({}),
  createPipelineLayout:()=>({}),
  createComputePipeline:({compute}:{compute:{entryPoint:string}})=>compute,
  createBindGroup:(desc:typeof bind)=>{if(!desc||desc.entries.length!==9)throw new Error('dag selection bind group requires 9 entries');bind=desc;return desc;},
  createCommandEncoder:()=>({
   beginComputePass:()=>({
    setPipeline(next:{entryPoint:string}){pipeline=next;},
    setBindGroup(_i:number,group:typeof bind){bind=group;},
    dispatchWorkgroups(){
     // The whole kernel is replayed once, on its last stage; the earlier stages still have to run.
     if(pipeline?.entryPoint!=='dagMask'||!bind)return;
     const byBinding=new Map(bind.entries.map(entry=>[entry.binding,entry.resource.buffer]));
     const {uniforms,residentCut}=readUniforms(byBinding.get(2)!.data);
     const resident=residentCut?Uint32Array.from({length:packed.pageCount},(_,id)=>packed.pageCones[id*12+11]):undefined;
     const result=evaluateDagSelectionKernel(packed,uniforms,resident);
     const out=byBinding.get(4)!.data;
     const ints=new Uint32Array(out.buffer,out.byteOffset,out.byteLength/4);
     ints.fill(0);
     ints[0]=result.pageIds.length;ints[1]=result.frustumRejected;ints[2]=result.lodLevel;ints[3]=result.complete===false?2:0;
     ints.set(result.pageIds,4);
     const flags=new Uint32Array(byBinding.get(3)!.data.buffer);flags.fill(0,packed.nodeCount);
     for(const id of result.drawablePageIds??[])flags[packed.nodeCount+id]=1;
    },
    end(){},
   }),
   copyBufferToBuffer(src:Buf,s:number,dst:Buf,d:number,size:number){dst.data.set(src.data.subarray(s,s+size),d);},
   finish:()=>({}),
  }),
  queue:{
   writeBuffer(buffer:Buf,offset:number,data:BufferSource){
    const bytes=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array((data as ArrayBufferView).buffer,(data as ArrayBufferView).byteOffset,(data as ArrayBufferView).byteLength);
    buffer.data.set(bytes,offset);
    if(buffer.size===256)uniformWriteCount++;
   },
   submit(){},
   onSubmittedWorkDone:async()=>{},
  },
 };
 return {device:device as unknown as GPUDevice,uniformWrites:()=>uniformWriteCount};
}

test('a device without compute pipelines keeps the CPU cut by not creating GPU selection',async()=>{
 const fixture=dagFixture();
 const {dag}=packed(fixture);
 const device={limits:{maxBufferSize:1<<20},createBuffer(){throw new Error('should not allocate');}} as unknown as GPUDevice;
 assert.equal(await createGpuDagSelection(device,dag),undefined);
 fixture.geometry.dispose();
});

test('an empty cluster set does not allocate a GPU selection',async()=>{
 installGpuGlobals();
 const dag=packDagSelection([]);
 assert.equal(dag.pageCount,0);
 assert.equal(await createGpuDagSelection(mockDagDevice(dag).device,dag),undefined);
});

test('GPU selection readback page ids match the CPU oracle for the same camera',async()=>{
 installGpuGlobals();
 const fixture=dagFixture();
 const {dag}=packed(fixture);
 const cam=wideCamera();
 const selection=await createGpuDagSelection(mockDagDevice(dag).device,dag);
 assert.ok(selection);
 selection.dispatch(cameraSelectionUniforms(cam,3.4,VIEWPORT));
 const gpu=await selection.flush();
 assert.ok(gpu);
 assert.deepEqual(gpu.pageIds.map(id=>dag.pageUrls[id]).sort(),cpuUrls(fixture,3.4,cam));
 assert.equal(selection.peek()?.uniforms.pixelError,3.4);
 selection.dispose();fixture.geometry.dispose();
});

test('unchanged uniforms skip a second GPU dispatch',async()=>{
 installGpuGlobals();
 const fixture=dagFixture();
 const {dag}=packed(fixture);
 const {device,uniformWrites}=mockDagDevice(dag);
 const selection=await createGpuDagSelection(device,dag);assert.ok(selection);
 const uniforms=cameraSelectionUniforms(wideCamera(),0,VIEWPORT);
 selection.dispatch(uniforms);await selection.flush();
 const afterFirst=uniformWrites();
 selection.dispatch(uniforms);await selection.flush();
 assert.equal(uniformWrites(),afterFirst);
 selection.dispose();fixture.geometry.dispose();
});

test('updating an instance world matrix invalidates the old GPU cut',async()=>{
 installGpuGlobals();
 const fixture=dagFixture();
 const {dag}=packed(fixture);
 const selection=await createGpuDagSelection(mockDagDevice(dag).device,dag);assert.ok(selection);
 const uniforms=cameraSelectionUniforms(wideCamera(),0,VIEWPORT);
 selection.dispatch(uniforms);assert.equal((await selection.flush())?.pageIds.length,4);
 const moved=dag.worlds.slice();moved[12]=1000;
 assert.equal(selection.updateWorlds(moved),true);assert.equal(selection.peek(),null);
 selection.dispatch(uniforms);assert.equal((await selection.flush())?.pageIds.length,0);
 selection.dispose();fixture.geometry.dispose();
});

test('the resident mask recomputes for residency changes with an unchanged camera',async()=>{
 installGpuGlobals();
 const fixture=dagFixture();
 const {dag}=packed(fixture);
 const {device,uniformWrites}=mockDagDevice(dag);
 const selection=await createGpuDagSelection(device,dag,{residentCut:true});assert.ok(selection);
 const uniforms=cameraSelectionUniforms(wideCamera(),0,VIEWPORT);
 const mask=()=>[...new Uint32Array((selection.maskBuffer as unknown as {data:Uint8Array}).data.buffer).slice(selection.maskOffset)]
  .flatMap((flag,id)=>flag?[dag.pageUrls[id]]:[]).sort();
 selection.updateResidency(Uint32Array.from(dag.pageUrls.map(url=>url==='root'?1:0)));
 selection.dispatch(uniforms);
 assert.deepEqual((await selection.flush())?.drawablePageIds?.map(id=>dag.pageUrls[id]),['root']);
 assert.deepEqual(mask(),['root']);
 selection.updateResidency(new Uint32Array(dag.pageCount).fill(1));
 assert.equal(selection.peek(),null);
 selection.dispatch(uniforms);
 assert.deepEqual((await selection.flush())?.drawablePageIds?.map(id=>dag.pageUrls[id]).sort(),['leaf0','leaf1','leaf2','leaf3']);
 assert.equal(uniformWrites(),2);
 assert.deepEqual(mask(),['leaf0','leaf1','leaf2','leaf3']);
 selection.dispose();fixture.geometry.dispose();
});

test('a failed readback marks GPU selection dead',async()=>{
 installGpuGlobals();
 const fixture=dagFixture();
 const {dag}=packed(fixture);
 const selection=await createGpuDagSelection(mockDagDevice(dag,{failMap:true}).device,dag);assert.ok(selection);
 selection.dispatch(cameraSelectionUniforms(wideCamera(),0,VIEWPORT));
 assert.equal(await selection.flush(),null);
 assert.equal(selection.failed(),true);
 assert.equal(selection.peek(),null);
 selection.dispose();fixture.geometry.dispose();
});

test('readback from an older resident cut cannot restore an invalidated drawable mask',async()=>{
 installGpuGlobals();let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const fixture=dagFixture();
 const {dag}=packed(fixture);
 const selection=await createGpuDagSelection(mockDagDevice(dag,{mapGate:gate}).device,dag,{residentCut:true});assert.ok(selection);
 selection.updateResidency(Uint32Array.from(dag.pageUrls.map(url=>url==='root'?1:0)));
 selection.dispatch(cameraSelectionUniforms(wideCamera(),0,VIEWPORT));
 selection.updateResidency(new Uint32Array(dag.pageCount).fill(1));
 release();assert.equal(await selection.flush(),null);assert.equal(selection.peek(),null);
 selection.dispose();fixture.geometry.dispose();
});
