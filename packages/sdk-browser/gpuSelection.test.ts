import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from 'three';
import type {Tree} from '../sdk-core/index.ts';
import {selectVisiblePages} from './pageSelection.ts';
import {cameraSelectionUniforms,createGpuSelection,evaluateSelectionKernel,packSelectionForest,SELECTION_SHADER} from './gpuSelection.ts';

type Rec={id:number;url:string;triangles:number;seen:number;cone?:{axis:[number,number,number];angle:number}};

function installGpuGlobals(){
 Object.assign(globalThis,{
  GPUBufferUsage:{MAP_READ:1,MAP_WRITE:2,COPY_SRC:4,COPY_DST:8,INDEX:16,VERTEX:32,UNIFORM:64,STORAGE:128,INDIRECT:256,QUERY_RESOLVE:512},
  GPUShaderStage:{VERTEX:1,FRAGMENT:2,COMPUTE:4},
  GPUMapMode:{READ:1,WRITE:2},
 });
}

function recs(pages:Array<{id:number;url:string;count:number}>):Rec[]{
 return pages.map(page=>({id:page.id,url:page.url,triangles:page.count/3,seen:0}));
}

function identityWorld(){return new THREE.Matrix4();}

function forest(pages:Rec[],hierarchy:Tree,world=identityWorld()){
 return [{tree:hierarchy,world,pages}];
}

function cameraAt(x:number,y:number,z:number,tx=0,ty=0,tz=0){
 const cam=new THREE.PerspectiveCamera(55,1,.1,100);cam.position.set(x,y,z);cam.lookAt(tx,ty,tz);cam.updateMatrixWorld();cam.updateProjectionMatrix();return cam;
}

function cpuCut(roots:ReturnType<typeof forest>,cam:THREE.PerspectiveCamera,pixelError:number,viewport:[number,number]){
 return selectVisiblePages(roots,cam,{pixelError,viewport,frame:1});
}

function gpuCut(roots:ReturnType<typeof forest>,cam:THREE.PerspectiveCamera,pixelError:number,viewport:[number,number]){
 const packed=packSelectionForest(roots);
 return evaluateSelectionKernel(packed,cameraSelectionUniforms(cam,pixelError,viewport));
}

function assertSameCut(roots:ReturnType<typeof forest>,cam:THREE.PerspectiveCamera,pixelError:number,viewport:[number,number]=[960,540]){
 const cpu=cpuCut(roots,cam,pixelError,viewport);
 const gpu=gpuCut(roots,cam,pixelError,viewport);
 assert.deepEqual(gpu.pageIds.map(i=>roots[0].pages[i]?.url??String(i)).sort(),cpu.shown.map(page=>page.url).sort());
 assert.equal(gpu.frustumRejected,cpu.frustumRejected);
 assert.equal(gpu.lodLevel,cpu.lodLevel);
}

const quadPages=recs([
 {id:0,url:'0',count:3},
 {id:1,url:'1',count:3},
]);
const quadTree:Tree={min:[-1,-1,0],max:[1,1,0],children:[
 {min:[-1,-1,0],max:[1,1,0],page:0},
 {min:[-1,-1,0],max:[1,1,0],page:1},
]};
const lodPages=recs([
 {id:0,url:'0',count:3},
 {id:1,url:'1',count:3},
 {id:2,url:'2',count:3},
]);
const lodTree:Tree={min:[-1,-1,0],max:[1,1,0],errorObject:0,coarsePages:[2],children:[
 {min:[-1,-1,0],max:[1,1,0],page:0},
 {min:[-1,-1,0],max:[1,1,0],page:1},
]};
const nestedPages=recs([
 {id:0,url:'0',count:3},
 {id:1,url:'1',count:3},
 {id:2,url:'2',count:3},
 {id:3,url:'3',count:3},
]);
const nestedTree:Tree={
 min:[-1,-1,0],max:[1,1,0],errorObject:1e6,coarsePages:[3],
 children:[{min:[-1,-1,0],max:[1,1,0],errorObject:0,coarsePages:[2],children:[
  {min:[-1,-1,0],max:[1,1,0],page:0},
  {min:[-1,-1,0],max:[1,1,0],page:1},
 ]}],
};

test('compute kernel page ids match the CPU frustum cut at the home pose',()=>{
 assertSameCut(forest(quadPages,quadTree),cameraAt(0,0,5),0);
});

test('compute kernel page ids match the CPU cut when the camera looks away',()=>{
 assertSameCut(forest(quadPages,quadTree),cameraAt(0,0,5,0,0,10),0);
});

test('compute kernel page ids match the CPU coarse LOD cut',()=>{
 assertSameCut(forest(lodPages,lodTree),cameraAt(0,0,5),10);
});

test('compute kernel keeps exact leaves when pixelError is 0',()=>{
 assertSameCut(forest(lodPages,lodTree),cameraAt(0,0,5),0);
});

test('compute kernel page ids match the CPU nested LOD cut',()=>{
 assertSameCut(forest(nestedPages,nestedTree),cameraAt(0,0,5),10);
});

test('compute kernel cone-rejects a back-facing leaf the CPU also rejects', () => {
  const pages = recs([{id:0,url:'front',count:3}]);
  (pages[0] as Rec & {cone: {axis:[number,number,number]; angle:number}}).cone = {axis:[0,0,1], angle: Math.PI/6};
  const tree: Tree = {min:[-0.1,-0.1,0],max:[0.1,0.1,0],page:0};
  const behind = cameraAt(0,0,-5,0,0,0);
  assertSameCut(forest(pages as Rec[], tree), behind, 0);
  const gpu = gpuCut(forest(pages as Rec[], tree), behind, 0);
  assert.equal(gpu.pageIds.length, 0);
});

test('compute kernel cone-rejects a back-facing coarse page the CPU also rejects', () => {
  const pages = recs([
    {id:0,url:'exact0',count:3},
    {id:1,url:'exact1',count:3},
    {id:2,url:'coarse',count:3},
  ]);
  (pages[2] as Rec & {cone: {axis:[number,number,number]; angle:number}}).cone = {axis:[0,0,1], angle: Math.PI/6};
  const tree: Tree = {min:[-0.1,-0.1,0],max:[0.1,0.1,0],errorObject:0,coarsePages:[2],children:[
    {min:[-0.1,-0.1,0],max:[0.1,0.1,0],page:0},
    {min:[-0.1,-0.1,0],max:[0.1,0.1,0],page:1},
  ]};
  const behind = cameraAt(0,0,-5,0,0,0);
  assertSameCut(forest(pages as Rec[], tree), behind, 10);
  const gpu = gpuCut(forest(pages as Rec[], tree), behind, 10);
  assert.equal(gpu.pageIds.length, 0);
});

test('compute kernel frustum-rejects a distant child the CPU also rejects',()=>{
 const pages=recs([
  {id:0,url:'near',count:3},
  {id:1,url:'far',count:3},
 ]);
 const tree:Tree={min:[-1,-1,0],max:[102,1,0],children:[
  {min:[-1,-1,0],max:[1,1,0],page:0},
  {min:[100,-1,0],max:[102,1,0],page:1},
 ]};
 assertSameCut(forest(pages,tree),cameraAt(0,0,5),0,[32,32]);
 assertSameCut(forest(pages,tree),cameraAt(101,0,5,101,0,0),0,[32,32]);
});

test('compute kernel page ids match the CPU cut across two roots',()=>{
 const pagesA=recs([{id:0,url:'a0',count:3}]);
 const pagesB=recs([{id:0,url:'b0',count:3}]);
 const treeA:Tree={min:[-1,-1,0],max:[1,1,0],page:0};
 const treeB:Tree={min:[8,-1,0],max:[10,1,0],page:0};
 const worldB=new THREE.Matrix4();
 const roots=[{tree:treeA,world:identityWorld(),pages:pagesA},{tree:treeB,world:worldB,pages:pagesB}];
 const cam=cameraAt(0,0,5);
 const cpu=selectVisiblePages(roots,cam,{pixelError:0,viewport:[960,540],frame:1});
 const packed=packSelectionForest(roots);
 const gpu=evaluateSelectionKernel(packed,cameraSelectionUniforms(cam,0,[960,540]));
 const urls=gpu.pageIds.map(id=>packed.pageUrls[id]);
 assert.deepEqual([...urls].sort(),cpu.shown.map(page=>page.url).sort());
 assert.equal(gpu.frustumRejected,cpu.frustumRejected);
});

test('selection shader walks the forest with an explicit stack',()=>{
 assert.match(SELECTION_SHADER,/while\s*\(\s*sp\s*>\s*0u\s*\)/);
 assert.doesNotMatch(SELECTION_SHADER,/\bfn visit\b/);
 assert.match(SELECTION_SHADER,/arrayLength\(\s*&out\.pages\s*\)/);
 assert.match(SELECTION_SHADER,/fn inverseTranspose3\s*\(/);
 assert.doesNotMatch(SELECTION_SHADER,/\binverse\s*\(/);
});

test('pack stores one world matrix per root',()=>{
 const pagesA=recs([{id:0,url:'a0',count:3}]);
 const pagesB=recs([{id:0,url:'b0',count:3}]);
 const packed=packSelectionForest([
  {tree:{min:[-1,-1,0],max:[1,1,0],page:0},world:identityWorld(),pages:pagesA},
  {tree:{min:[8,-1,0],max:[10,1,0],page:0},world:new THREE.Matrix4().setPosition(8,0,0),pages:pagesB},
 ]);
 assert.equal(packed.worldCount,2);
 assert.equal(packed.worlds.length,32);
 assert.equal(packed.meta[7],0);
 assert.equal(packed.meta[packed.meta.length-1],1);
});

test('a device without compute pipelines keeps the CPU cut by not creating GPU selection',async()=>{
 const packed=packSelectionForest(forest(quadPages,quadTree));
 const device={limits:{maxBufferSize:1<<20},createBuffer(){throw new Error('should not allocate');}} as unknown as GPUDevice;
 assert.equal(await createGpuSelection(device,packed),undefined);
});

test('an empty forest does not allocate a GPU selection',async()=>{
 installGpuGlobals();
 const packed=packSelectionForest([]);
 assert.equal(packed.nodeCount,0);
 const {device}=mockSelectionDevice(packed);
 assert.equal(await createGpuSelection(device,packed),undefined);
});

test('GPU selection readback page ids match the CPU oracle for the same camera',async()=>{
 installGpuGlobals();
 const roots=forest(lodPages,lodTree);
 const packed=packSelectionForest(roots);
 const cam=cameraAt(0,0,5);
 const uniforms=cameraSelectionUniforms(cam,10,[960,540]);
 const cpu=cpuCut(roots,cam,10,[960,540]);
 const {device}=mockSelectionDevice(packed);
 const selection=await createGpuSelection(device,packed);
 assert.ok(selection);
 selection!.dispatch(uniforms);
 const gpu=await selection!.flush();
 assert.ok(gpu);
 const peeked=selection!.peek();
 assert.ok(peeked);
 assert.equal(peeked!.uniforms.pixelError,10);
 assert.deepEqual(gpu!.pageIds.map(i=>packed.pageUrls[i]).sort(),cpu.shown.map(page=>page.url).sort());
 assert.equal(gpu!.frustumRejected,cpu.frustumRejected);
 assert.equal(gpu!.lodLevel,cpu.lodLevel);
 selection!.dispose();
});

test('unchanged uniforms skip a second GPU dispatch',async()=>{
 installGpuGlobals();
 const packed=packSelectionForest(forest(quadPages,quadTree));
 const {device,uniformWrites}=mockSelectionDevice(packed);
 const selection=await createGpuSelection(device,packed);
 const uniforms=cameraSelectionUniforms(cameraAt(0,0,5),0,[960,540]);
 selection!.dispatch(uniforms);
 await selection!.flush();
 const afterFirst=uniformWrites();
 selection!.dispatch(uniforms);
 await selection!.flush();
 assert.equal(uniformWrites(),afterFirst);
 selection!.dispose();
});

test('peek keeps the uniforms that produced the completed cut',async()=>{
 installGpuGlobals();
 const packed=packSelectionForest(forest(quadPages,quadTree));
 const {device}=mockSelectionDevice(packed);
 const selection=await createGpuSelection(device,packed);
 const home=cameraSelectionUniforms(cameraAt(0,0,5),0,[960,540]);
 const away=cameraSelectionUniforms(cameraAt(0,0,5,0,0,10),0,[960,540]);
 selection!.dispatch(home);
 await selection!.flush();
 assert.equal(selection!.peek()!.result.pageIds.length,2);
 selection!.dispatch(away);
 await selection!.flush();
 assert.equal(selection!.peek()!.result.pageIds.length,0);
 selection!.dispose();
});

test('a failed readback marks GPU selection dead',async()=>{
 installGpuGlobals();
 const packed=packSelectionForest(forest(quadPages,quadTree));
 const {device}=mockSelectionDevice(packed,{failMap:true});
 const selection=await createGpuSelection(device,packed);
 selection!.dispatch(cameraSelectionUniforms(cameraAt(0,0,5),0,[960,540]));
 assert.equal(await selection!.flush(),null);
 assert.equal(selection!.failed(),true);
 assert.equal(selection!.peek(),null);
 selection!.dispose();
});

function mockSelectionDevice(packed:ReturnType<typeof packSelectionForest>,options:{failMap?:boolean}={}){
 const buffers:Array<{size:number;usage:number;data:Uint8Array}>=[];
 let bind:{entries:Array<{binding:number;resource:{buffer:(typeof buffers)[number]}}>} | undefined;
 let pipeline:{entryPoint:string}|undefined,uniformWriteCount=0;
 const device={
  limits:{maxBufferSize:1<<20,maxStorageBufferBindingSize:1<<20},
  createBuffer:({size,usage}:{size:number;usage:number})=>{
   const data=new Uint8Array(size);
   const buffer={size,usage,data,destroy(){},mapAsync:async()=>{if(options.failMap)throw new Error('MAP_FAILED');},getMappedRange:()=>data.buffer,unmap(){}};
   buffers.push(buffer);return buffer;
  },
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
  createBindGroupLayout:()=>({}),
  createPipelineLayout:()=>({}),
  createComputePipeline:({compute}:{compute:{entryPoint:string}})=>compute,
  createBindGroup:(desc:typeof bind)=>{if(!desc||desc.entries.length!==9)throw new Error('selection bind group requires 9 entries');bind=desc;return desc;},
  createCommandEncoder:()=>({
   beginComputePass:()=>({
    setPipeline(next:{entryPoint:string}){pipeline=next;},
    setBindGroup(_i:number,group:typeof bind){bind=group;},
    dispatchWorkgroups(){
     if(pipeline?.entryPoint!=='resolveSelection'||!bind)return;
     const byBinding=new Map(bind.entries.map(entry=>[entry.binding,entry.resource.buffer]));
     const result=evaluateSelectionKernel(packed,readUniforms(byBinding.get(2)!.data));
     const out=byBinding.get(4)!.data;
     const ints=new Uint32Array(out.buffer,out.byteOffset,out.byteLength/4);
     ints[0]=result.pageIds.length;ints[1]=result.frustumRejected;ints[2]=result.lodLevel;ints[3]=0;
     ints.set(result.pageIds,4);
    },
    end(){},
   }),
   copyBufferToBuffer(src:{data:Uint8Array},s:number,dst:{data:Uint8Array},d:number,size:number){dst.data.set(src.data.subarray(s,s+size),d);},
   finish:()=>({}),
  }),
  queue:{
   writeBuffer(buffer:{size:number;data:Uint8Array},offset:number,data:BufferSource){
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

function readUniforms(data:Uint8Array){
 const f32=new Float32Array(data.buffer,data.byteOffset,data.byteLength/4);
 const u32=new Uint32Array(data.buffer,data.byteOffset,data.byteLength/4);
 const planes=f32.slice(0,24);
 const view=f32.slice(24,40);
 return {planes,view,pixelScale:[f32[40],f32[41]] as [number,number],pixelError:f32[42],near:f32[43],cameraWorld:[f32[48],f32[49],f32[50]] as [number,number,number],nodeCount:u32[44],rootCount:u32[45]};
}
