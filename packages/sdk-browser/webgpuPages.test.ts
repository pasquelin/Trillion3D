import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from 'three';
import {compareImages} from '../sdk-core/index.ts';
import {exactPagesBackend} from './index.ts';
import {webgpuPagesBackend} from './webgpuPages.ts';
import {rasterPageRecords} from './pageRaster.ts';
import {collectClusterPages,selectVisiblePages} from './pageSelection.ts';
import {evaluateSelectionKernel,packSelectionForest,type PackedForest} from './gpuSelection.ts';
import {evaluateDrawCompact,type DrawItem} from './gpuDraw.ts';
import {rasterVisibilityIds,shadeVisibility,unpackVisibilityId} from './visibilityBuffer.ts';

function installGpuGlobals(){
 Object.assign(globalThis,{
  GPUBufferUsage:{MAP_READ:1,MAP_WRITE:2,COPY_SRC:4,COPY_DST:8,INDEX:16,VERTEX:32,UNIFORM:64,STORAGE:128,INDIRECT:256,QUERY_RESOLVE:512},
  GPUTextureUsage:{COPY_SRC:1,COPY_DST:2,TEXTURE_BINDING:4,STORAGE_BINDING:8,RENDER_ATTACHMENT:16},
  GPUShaderStage:{VERTEX:1,FRAGMENT:2,COMPUTE:4},
  GPUMapMode:{READ:1,WRITE:2},
 });
}

function bytesOf(data:BufferSource){
 if(data instanceof ArrayBuffer)return new Uint8Array(data);
 return new Uint8Array((data as ArrayBufferView).buffer,(data as ArrayBufferView).byteOffset,(data as ArrayBufferView).byteLength);
}

function mockGpu(limits:Record<string,number>={maxBufferSize:1<<20,maxStorageBufferBindingSize:1<<20},packed?:PackedForest,failMap=false,rejectR32=false,failVisPass=false,enableHiz=false){
 const draws:Array<{vertexCount:number;instanceCount?:number;firstInstance?:number;indirect?:boolean}>=[],writes:Array<{offset:number;bytes:Uint8Array}>=[];
 const textures:Array<{format?:string;usage?:number;depthOrArrayLayers:number;views:Array<{dimension?:string}|undefined>}>=[];
 const passes:Array<{colorLoad?:string;depthLoad?:string;colorCount:number;formats:string[]}>=[];
 const computes:string[]=[];
 const layouts:Array<{entries:Array<{binding:number;buffer?:{type?:string}}>}>=[];
 let lostResolve:((info:{reason:string;message:string})=>void)|undefined;
 const lost=new Promise<{reason:string;message:string}>(resolve=>{lostResolve=resolve;});
 let currentBind:unknown,computeBind:{entries:Array<{binding:number;resource:{buffer:{data:Uint8Array}}}>}|undefined,computePipeline:{entryPoint:string}|undefined,visPassFails=failVisPass;
 const device:{[key:string]:unknown}={
  limits,lost,
  createBuffer:({size,usage}:{size:number;usage:number})=>{
   const data=new Uint8Array(size);
   return {size,usage,data,destroy(){},mapAsync:async()=>{if(failMap)throw new Error('MAP_FAILED');},getMappedRange:()=>data.buffer,unmap(){}};
  },
  createTexture:({size,format,usage}:{size:{width:number;height:number;depthOrArrayLayers?:number};format?:string;usage?:number})=>{
   const views:Array<{dimension?:string}|undefined>=[];
   const tex={width:size.width,height:size.height,depthOrArrayLayers:size.depthOrArrayLayers??1,format,usage,views,destroy(){},createView(desc?:{dimension?:string}){const view={format,...desc};views.push(view);return view;}};
   textures.push(tex);return tex;
  },
  createSampler:()=>({}),
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
  createBindGroupLayout:(desc:{entries:Array<{binding:number;buffer?:{type?:string}}>})=>{layouts.push(desc);return desc;},
  createPipelineLayout:()=>({}),
  createRenderPipeline:(desc:{fragment?:{targets?:Array<{format?:string}>}})=>{
   if(rejectR32&&desc.fragment?.targets?.[0]?.format==='r32uint')throw new Error('NO_R32UINT');
   return {};
  },
  createBindGroup:(desc:unknown)=>desc,
  createCommandEncoder:()=>({
   beginRenderPass:(desc?:{colorAttachments?:Array<{loadOp?:string;view?:{format?:string}}>;depthStencilAttachment?:{depthLoadOp?:string}})=>{
    if(visPassFails){visPassFails=false;throw new Error('VIS_FAIL');}
    const colors=desc?.colorAttachments??[];
    passes.push({colorLoad:colors[0]?.loadOp,depthLoad:desc?.depthStencilAttachment?.depthLoadOp,colorCount:colors.length,formats:colors.map(color=>color.view?.format??'')});
    return {
    setPipeline(){},setBindGroup(_i:number,group:unknown){currentBind=group;},setViewport(){},
    draw(vertexCount:number,instanceCount=1,_firstVertex=0,firstInstance=0){draws.push({vertexCount,instanceCount,firstInstance});void currentBind;},
    drawIndirect(buffer:{data?:Uint8Array}, offset:number){
      const words=new Uint32Array(buffer.data!.buffer, buffer.data!.byteOffset+offset, 4);
      draws.push({vertexCount:words[0], instanceCount:words[1], indirect:true});
    },
    end(){},
   };},
   beginComputePass:()=>({
    setPipeline(next:{entryPoint:string}){computePipeline=next;},
    setBindGroup(_i:number,group:typeof computeBind){computeBind=group;},
    dispatchWorkgroups(){
     if(computePipeline?.entryPoint)computes.push(computePipeline.entryPoint);
     if(computePipeline?.entryPoint==='compactDraws'&&computeBind){
      const byBinding=new Map(computeBind.entries.map(entry=>[entry.binding,entry.resource.buffer]));
      const uniBytes=byBinding.get(1)!.data;
      const uni=new Uint32Array(uniBytes.buffer,uniBytes.byteOffset,uniBytes.byteLength/4);
      const count=uni[0],maxVertexCount=uni[1],slotCap=uni[2];
      const itemBytes=byBinding.get(0)!.data;
      const itemInts=new Uint32Array(itemBytes.buffer,itemBytes.byteOffset,itemBytes.byteLength/4);
      const n=Math.min(count,slotCap);
      const items:DrawItem[]=[];
      for(let i=0;i<n;i++)items.push({pageIndex:itemInts[i*3],bin:itemInts[i*3+1] as 0|1|2,rest:itemInts[i*3+2] as 0|1});
      const source=count>slotCap?items.concat(Array.from({length:count-n},()=>({pageIndex:0,bin:0 as const,rest:0 as const}))):items;
      const result=evaluateDrawCompact(source,maxVertexCount,slotCap);
      const instBytes=byBinding.get(2)!.data;
      new Uint32Array(instBytes.buffer,instBytes.byteOffset,instBytes.byteLength/4).set(result.instances);
      const indBytes=byBinding.get(3)!.data;
      new Uint32Array(indBytes.buffer,indBytes.byteOffset,indBytes.byteLength/4).set(result.indirect);
      return;
     }
     if(!packed||computePipeline?.entryPoint!=='resolveSelection'||!computeBind)return;
     const byBinding=new Map(computeBind.entries.map(entry=>[entry.binding,entry.resource.buffer]));
     const data=byBinding.get(2)!.data;
     const f32=new Float32Array(data.buffer,data.byteOffset,data.byteLength/4);
     const result=evaluateSelectionKernel(packed,{
      planes:f32.slice(0,24),view:f32.slice(24,40),pixelScale:[f32[40],f32[41]],pixelError:f32[42],near:f32[43],
      cameraWorld:[f32[48],f32[49],f32[50]],
     });
     const out=byBinding.get(4)!.data;
     const ints=new Uint32Array(out.buffer,out.byteOffset,out.byteLength/4);
     ints[0]=result.pageIds.length;ints[1]=result.frustumRejected;ints[2]=result.lodLevel;ints[3]=0;ints.set(result.pageIds,4);
    },
    end(){},
   }),
   copyBufferToBuffer(src:{data?:Uint8Array},s:number,dst:{data?:Uint8Array},d:number,size:number){if(src.data&&dst.data)dst.data.set(src.data.subarray(s,s+size),d);},
   copyTextureToBuffer(){},
   finish:()=>({}),
  }),
  queue:{
   writeBuffer(buffer:{data?:Uint8Array},offset:number,data:BufferSource){
    const bytes=bytesOf(data);writes.push({offset,bytes:new Uint8Array(bytes)});buffer.data?.set(bytes,offset);
   },
   writeTexture(){},
   submit(){},
   onSubmittedWorkDone:async()=>{},
  },
 };
 if(packed||enableHiz)device.createComputePipeline=({compute}:{compute:{entryPoint:string}})=>compute;
 return {device:device as unknown as GPUDevice,draws,writes,textures,passes,computes,layouts,lose:(reason='destroyed')=>lostResolve?.({reason,message:reason})};
}

function quadScene(){
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial({color:0xff0000}),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[0,1].map(id=>({id,url:String(id),count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x'}));
 const metadata={primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy:{min:[-1,-1,0],max:[1,1,0],children:pages.map(p=>({min:p.min,max:p.max,page:p.id}))}}]};
 const indices=new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])]]);
 const associations=new Map([[mesh,{meshes:0,primitives:0}]]);
 return {geometry,material,source,pages,metadata,indices,associations};
}

function camera(){
 const cam=new THREE.PerspectiveCamera(55,1,.1,100);cam.position.z=5;cam.lookAt(0,0,0);cam.updateMatrixWorld();return cam;
}

test('vis pipeline layout stores the page table at binding 2',async()=>{
 installGpuGlobals();
 const {device,layouts}=mockGpu();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 const visLayout=layouts.find(layout=>layout.entries.some(entry=>entry.binding===4&&entry.buffer?.type==='uniform')&&layout.entries.some(entry=>entry.binding===2&&entry.buffer?.type==='read-only-storage'));
 assert.ok(visLayout);
 assert.equal(visLayout.entries.find(entry=>entry.binding===2)?.buffer?.type,'read-only-storage');
 assert.equal(visLayout.entries.find(entry=>entry.binding===4)?.buffer?.type,'uniform');
 backend.dispose();geometry.dispose();material.dispose();
});
test('vis draws instance each packed page from the page table',async()=>{
 installGpuGlobals();
 const {device,draws}=mockGpu();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 backend.render(camera());
 await backend.flush?.();
 backend.render(camera());
 const instances=new Set(draws.map(draw=>draw.firstInstance));
 assert.ok(instances.has(0));
 assert.ok(instances.has(1));
 backend.dispose();geometry.dispose();material.dispose();
});
test('webgpu map atlas is a Chrome copyExternalImageToTexture destination',async()=>{
 installGpuGlobals();
 const {device,textures}=mockGpu();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 const atlas=textures.find(texture=>texture.depthOrArrayLayers>1);
 assert.ok(atlas);
 const need=GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT;
 assert.equal((atlas.usage??0)&need,need);
 backend.dispose();geometry.dispose();material.dispose();
});
test('webgpu pages raster consumes the GPU cache and does not attach a mesh per visible page',async()=>{
 installGpuGlobals();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const collected=collectClusterPages(source,metadata,indices,associations);
 const {device,draws,writes}=mockGpu(undefined,packSelectionForest(collected.roots));
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 backend.render(camera());
 await backend.flush?.();
 backend.render(camera());
 let pageMeshes=0;backend.scene.traverse(o=>{if((o as THREE.Mesh).isMesh&&!(o as THREE.Mesh).userData.blit)pageMeshes++;});
 assert.equal(pageMeshes,0);
 assert.equal(backend.metrics().clusters,2);
 assert.equal(backend.metrics().selectedTriangles,2);
 assert.equal(backend.metrics().residentPages,2);
 assert.ok(writes.length>=2);
 assert.equal(draws.reduce((n,d)=>n+d.vertexCount,0),9);
 assert.equal(backend.capabilities.unsupported.includes('visibility buffer'),false);
 backend.dispose();geometry.dispose();material.dispose();
});

test('webgpu page raster matches the WebGL2 exact-pages triangles',async()=>{
 installGpuGlobals();
 const {device}=mockGpu();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const context={source,metadata,indices,associations,maxResidentPages:2,viewport:[32,32] as [number,number]};
 const webgl=exactPagesBackend(context);
 const webgpu=webgpuPagesBackend({...context,gpuDevice:device});
 const cam=camera();
 webgl.render(cam);
 await webgpu.prepare();webgpu.render(cam);await webgpu.flush?.();webgpu.render(cam);
 const expected=rasterPageRecords(webgl,cam,[32,32]);
 const observed=webgpu.rasterRgba!();
 const image=compareImages(expected,observed);
 assert.equal(image.maxChannelError,0);
 webgl.dispose();webgpu.dispose();geometry.dispose();material.dispose();
});

test('webgpu pages refuse an incomplete surface when the visible set exceeds the slot budget',async()=>{
 installGpuGlobals();
 const {device,draws}=mockGpu();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:1,viewport:[32,32]});
 await backend.prepare();
 backend.render(camera());
 await backend.flush?.();
 backend.render(camera());
 assert.equal(backend.overBudget,true);
 assert.equal(backend.metrics().residentPages,1);
 assert.ok(draws.length>=1);
 backend.dispose();geometry.dispose();material.dispose();
});

test('pinned visible pages are not evicted when another page is loaded',async()=>{
 installGpuGlobals();
 const {device}=mockGpu();
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0,100,-1,0,102,-1,0,102,1,0],3));geometry.setIndex([0,1,2,0,2,3,4,5,6]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[
  {id:0,url:'0',count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x'},
  {id:1,url:'1',count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x'},
  {id:2,url:'2',count:3,min:[100,-1,0] as number[],max:[102,1,0] as number[],bytes:12,sha256:'x'},
 ];
 const metadata={primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy:{min:[-1,-1,0],max:[102,1,0],children:pages.map(p=>({min:p.min,max:p.max,page:p.id}))}}]};
 const indices=new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])],['2',new Uint32Array([4,5,6])]]);
 const backend=webgpuPagesBackend({source,metadata,indices,associations:new Map([[mesh,{meshes:0,primitives:0}]]),gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 const cam=camera();
 backend.render(cam);
 await backend.flush?.();
 backend.render(cam);
 const first=backend.metrics().residentPages;
 assert.equal(first,2);
 cam.position.set(101,0,5);cam.lookAt(101,0,0);cam.updateMatrixWorld();
 backend.render(cam);
 await backend.flush?.();
 backend.render(cam);
 assert.ok((backend.metrics().residentPages??0)<=2);
 assert.equal(backend.overBudget,false);
 backend.dispose();geometry.dispose();material.dispose();
});

test('webgpu pages select the same coarse LOD cut as the WebGL2 exact backend',async()=>{
 installGpuGlobals();
 const {device}=mockGpu();
 const {source,metadata:base,indices,associations,geometry,material}=quadScene();
 const pages=[
  {id:0,url:'0',count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x',role:'exact' as const},
  {id:1,url:'1',count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x',role:'exact' as const},
  {id:2,url:'2',count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x',role:'coarse' as const},
 ];
 const hierarchy={min:[-1,-1,0],max:[1,1,0],errorObject:0,coarsePages:[2],children:[{min:[-1,-1,0],max:[1,1,0],page:0},{min:[-1,-1,0],max:[1,1,0],page:1}]};
 const metadata={primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy}]};
 const allIndices=new Map([...indices,['2',new Uint32Array([0,1,2])]]);
 const context={source,metadata,indices:allIndices,associations,pixelError:10,viewport:[960,540] as [number,number]};
 const webgl=exactPagesBackend(context);
 const webgpu=webgpuPagesBackend({...context,gpuDevice:device,maxResidentPages:4});
 const cam=camera();
 webgl.render(cam);
 await webgpu.prepare();webgpu.render(cam);await webgpu.flush?.();webgpu.render(cam);
 assert.equal(webgpu.metrics().clusters,webgl.metrics().clusters);
 assert.equal(webgpu.metrics().selectedTriangles,webgl.metrics().selectedTriangles);
 webgl.dispose();webgpu.dispose();geometry.dispose();material.dispose();
 void base;
});

test('a lost WebGPU device fails the backend without throwing from dispose',async()=>{
 installGpuGlobals();
 const {device,lose}=mockGpu();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 lose('destroyed');
 await Promise.resolve();
 assert.throws(()=>backend.render(camera()),/WEBGPU_LOST/);
 await backend.dispose();
 geometry.dispose();material.dispose();
});

test('webgpu pages draw the resident subset before every visible page is loaded',async()=>{
 installGpuGlobals();
 const {device,draws}=mockGpu();
 const {source,metadata,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices:new Map(),associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 backend.render(camera());
 assert.equal(draws.length,0);
 backend.acceptPage?.('0',new Uint32Array([0,1,2]));
 backend.render(camera());
 await backend.flush?.();
 backend.render(camera());
 assert.equal(backend.metrics().clusters,2);
 assert.equal(backend.metrics().residentPages,1);
 assert.ok(draws.reduce((n,d)=>n+d.vertexCount,0)>=3);
 backend.dispose();geometry.dispose();material.dispose();
});
test('webgpu pages prepare without resident bytes and stream the visible set',async()=>{
 installGpuGlobals();
 const {device,draws}=mockGpu();
 const {source,metadata,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices:new Map(),associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 backend.render(camera());
 assert.deepEqual(backend.pendingUrls?.().sort(),['0','1']);
 assert.equal(draws.length,0);
 backend.acceptPage?.('0',new Uint32Array([0,1,2]));
 backend.acceptPage?.('1',new Uint32Array([0,2,3]));
 backend.render(camera());
 await backend.flush?.();
 backend.render(camera());
 assert.equal(backend.metrics().residentPages,2);
 assert.equal(draws.reduce((n,d)=>n+d.vertexCount,0),9);
 backend.dispose();geometry.dispose();material.dispose();
});

test('webgpu pages without a device fail prepare so the explorer can keep the Three.js path',async()=>{
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices,associations,maxResidentPages:2,viewport:[32,32]});
 await assert.rejects(backend.prepare(),/WEBGPU_UNAVAILABLE/);
 backend.dispose();geometry.dispose();material.dispose();
});

test('webgpu pages without compute keep the CPU cut and report gpuDriven false',async()=>{
 installGpuGlobals();
 const {device}=mockGpu();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 assert.equal(backend.capabilities.gpuDriven,false);
 backend.render(camera());
 assert.deepEqual(backend.selectedPageIds().sort(),['0','1']);
 backend.dispose();geometry.dispose();material.dispose();
});

test('webgpu compute selection page ids match the CPU oracle for the same camera and pixelError',async()=>{
 installGpuGlobals();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const collected=collectClusterPages(source,metadata,indices,associations);
 const packed=packSelectionForest(collected.roots);
 const {device}=mockGpu(undefined,packed);
 const viewport:[number,number]=[960,540];
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:4,viewport,pixelError:0});
 const cam=camera();
 const cpu=selectVisiblePages(collected.roots,cam,{pixelError:0,viewport,frame:1});
 await backend.prepare();
 assert.equal(backend.capabilities.gpuDriven,true);
 backend.render(cam);
 await backend.flush();
 backend.render(cam);
 assert.deepEqual(backend.selectedPageIds().sort(),cpu.shown.map(page=>page.url).sort());
 assert.equal(backend.metrics().clusters,cpu.visible);
 assert.equal(backend.metrics().frustumRejected,cpu.frustumRejected);
 backend.dispose();geometry.dispose();material.dispose();
});

test('webgpu compute selection matches the CPU coarse LOD cut',async()=>{
 installGpuGlobals();
 const {source,metadata:base,indices,associations,geometry,material}=quadScene();
 const pages=[
  {id:0,url:'0',count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x',role:'exact' as const},
  {id:1,url:'1',count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x',role:'exact' as const},
  {id:2,url:'2',count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x',role:'coarse' as const},
 ];
 const hierarchy={min:[-1,-1,0],max:[1,1,0],errorObject:0,coarsePages:[2],children:[{min:[-1,-1,0],max:[1,1,0],page:0},{min:[-1,-1,0],max:[1,1,0],page:1}]};
 const metadata={primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy}]};
 const allIndices=new Map([...indices,['2',new Uint32Array([0,1,2])]]);
 const viewport:[number,number]=[960,540];
 const collected=collectClusterPages(source,metadata,allIndices,associations);
 const packed=packSelectionForest(collected.roots);
 const {device}=mockGpu(undefined,packed);
 const backend=webgpuPagesBackend({source,metadata,indices:allIndices,associations,gpuDevice:device,maxResidentPages:4,viewport,pixelError:10});
 const cam=camera();
 const cpu=selectVisiblePages(collected.roots,cam,{pixelError:10,viewport,frame:1});
 await backend.prepare();
 backend.render(cam);
 await backend.flush();
 backend.render(cam);
 assert.equal(backend.capabilities.gpuDriven,true);
 assert.deepEqual(backend.selectedPageIds().sort(),cpu.shown.map(page=>page.url).sort());
 assert.equal(backend.metrics().clusters,cpu.visible);
 assert.equal(backend.metrics().lodLevel,cpu.lodLevel);
 backend.dispose();geometry.dispose();material.dispose();
 void base;
});

test('GPU page ids skip a non-hierarchy primitive that sits first in allPages',async()=>{
 installGpuGlobals();
 const geoA=new THREE.BufferGeometry();geoA.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0],3));geoA.setIndex([0,1,2]);
 const geoB=new THREE.BufferGeometry();geoB.setAttribute('position',new THREE.Float32BufferAttribute([8,-1,0,10,-1,0,10,1,0],3));geoB.setIndex([0,1,2]);
 const material=new THREE.MeshBasicMaterial(),meshA=new THREE.Mesh(geoA,material),meshB=new THREE.Mesh(geoB,material),source=new THREE.Group();source.add(meshA,meshB);
 const pagesA=[{id:0,url:'orphan',count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x'}];
 const pagesB=[{id:0,url:'exact',count:3,min:[8,-1,0] as number[],max:[10,1,0] as number[],bytes:12,sha256:'x'}];
 const metadata={primitives:[
  {mesh:0,primitive:0,pass:'exact-clusters',pages:pagesA,hierarchy:null},
  {mesh:1,primitive:0,pass:'exact-clusters',pages:pagesB,hierarchy:{min:[8,-1,0],max:[10,1,0],page:0}},
 ]};
 const indices=new Map([['orphan',new Uint32Array([0,1,2])],['exact',new Uint32Array([0,1,2])]]);
 const associations=new Map([[meshA,{meshes:0,primitives:0}],[meshB,{meshes:1,primitives:0}]]);
 const collected=collectClusterPages(source,metadata,indices,associations);
 const packed=packSelectionForest(collected.roots);
 const {device}=mockGpu(undefined,packed);
 const viewport:[number,number]=[32,32];
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:4,viewport});
 const cam=new THREE.PerspectiveCamera(55,1,.1,100);cam.position.set(9,0,5);cam.lookAt(9,0,0);cam.updateMatrixWorld();
 await backend.prepare();
 backend.render(cam);
 await backend.flush();
 backend.render(cam);
 assert.deepEqual(backend.selectedPageIds(),['exact']);
 backend.dispose();geoA.dispose();geoB.dispose();material.dispose();
});

test('a failed GPU selection readback falls back to the CPU cut and clears gpuDriven',async()=>{
 installGpuGlobals();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const collected=collectClusterPages(source,metadata,indices,associations);
 const packed=packSelectionForest(collected.roots);
 const {device}=mockGpu(undefined,packed,true);
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 assert.equal(backend.capabilities.gpuDriven,true);
 backend.render(camera());
 await backend.flush();
 assert.equal(backend.capabilities.gpuDriven,false);
 backend.render(camera());
 assert.deepEqual(backend.selectedPageIds().sort(),['0','1']);
 backend.dispose();geometry.dispose();material.dispose();
});

test('webgpu visbuffer ids match the CPU oracle for a stable pose',async()=>{
 installGpuGlobals();
 const {device,textures}=mockGpu();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 const cam=camera();
 await backend.prepare();
 assert.equal(backend.capabilities.unsupported.includes('visibility buffer'),false);
 backend.render(cam);await backend.flush();backend.render(cam);
 const mesh=source.children[0] as THREE.Mesh;
 const pages=[{array:indices.get('0')!,attributes:geometry.attributes,matrix:mesh.matrixWorld,material},{array:indices.get('1')!,attributes:geometry.attributes,matrix:mesh.matrixWorld,material}];
 const expected=rasterVisibilityIds(pages,cam,[32,32]);
 const observed=backend.visibilityIds();
 assert.deepEqual(observed,expected);
 assert.deepEqual(observed,backend.visibilityIds());
 const image=compareImages(backend.rasterRgba(),shadeVisibility(expected,pages,cam,[32,32]));
 assert.equal(image.maxChannelError,0);
 const maps=textures.find(t=>t.format==='rgba8unorm-srgb');
 assert.ok(maps);
 assert.ok(maps.depthOrArrayLayers>=2);
 assert.ok(maps.views.some(view=>view?.dimension==='2d-array'));
 backend.dispose();geometry.dispose();material.dispose();
});

test('webgpu Hi-Z remaining pages stay a subset of the CPU selection oracle',async()=>{
 installGpuGlobals();
 const {device}=mockGpu();
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0,-0.2,-0.2,-2,0.2,-0.2,-2,0.2,0.2,-2,-0.2,0.2,-2],3));
 geometry.setIndex([0,1,2,0,2,3,4,5,6,4,6,7]);
 const material=new THREE.MeshBasicMaterial({color:0xff0000}),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[
  {id:0,url:'front',count:6,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:24,sha256:'x'},
  {id:1,url:'back',count:6,min:[-0.2,-0.2,-2] as number[],max:[0.2,0.2,-2] as number[],bytes:24,sha256:'x'},
 ];
 const metadata={primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy:{min:[-1,-1,-2],max:[1,1,0],children:pages.map(p=>({min:p.min,max:p.max,page:p.id}))}}]};
 const indices=new Map([['front',new Uint32Array([0,1,2,0,2,3])],['back',new Uint32Array([4,5,6,4,6,7])]]);
 const associations=new Map([[mesh,{meshes:0,primitives:0}]]);
 const viewport:[number,number]=[32,32];
 const collected=collectClusterPages(source,metadata,indices,associations);
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:4,viewport});
 const cam=camera();
 const cpu=selectVisiblePages(collected.roots,cam,{pixelError:0,viewport,frame:1});
 await backend.prepare();
 assert.equal(backend.capabilities.unsupported.includes('occlusion culling'),false);
 backend.render(cam);await backend.flush();backend.render(cam);
 const selected=cpu.shown.map(page=>page.url).sort();
 assert.deepEqual(backend.selectedPageIds().sort(),selected);
 assert.deepEqual(selected,['back','front']);
 const visPages=cpu.shown.filter(page=>page.array).map(page=>({...page,array:page.array!}));
 assert.equal(compareImages(backend.rasterRgba(),shadeVisibility(rasterVisibilityIds(visPages,cam,viewport),visPages,cam,viewport)).maxChannelError,0);
 const drawn=new Set([...backend.visibilityIds()].flatMap(id=>{const unpacked=unpackVisibilityId(id);return unpacked?[unpacked.pageIndex]:[];}));
 assert.deepEqual([...drawn].sort(),[0]);
 assert.ok((backend.metrics().submittedTriangles??0)<(backend.metrics().selectedTriangles??0));
 backend.dispose();geometry.dispose();material.dispose();
});

test('a visbuffer encode failure restores occlusion culling as unsupported',async()=>{
 installGpuGlobals();
 const {device}=mockGpu(undefined,undefined,false,false,true);
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 assert.equal(backend.capabilities.unsupported.includes('occlusion culling'),false);
 const cam=camera();
 backend.render(cam);await backend.flush();
 backend.render(cam);
 assert.equal(backend.capabilities.unsupported.includes('occlusion culling'),true);
 assert.equal(backend.capabilities.unsupported.includes('visibility buffer'),true);
 backend.dispose();geometry.dispose();material.dispose();
});

test('a missing r32uint vis target keeps the page raster and lists visibility buffer as unsupported',async()=>{
 installGpuGlobals();
 const {device,draws}=mockGpu(undefined,undefined,false,true);
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 assert.equal(backend.capabilities.unsupported.includes('visibility buffer'),true);
 assert.equal(backend.capabilities.unsupported.includes('occlusion culling'),true);
 backend.render(camera());await backend.flush();backend.render(camera());
 assert.deepEqual(backend.selectedPageIds().sort(),['0','1']);
 assert.equal(draws.reduce((n,d)=>n+d.vertexCount,0),6);
 backend.dispose();geometry.dispose();material.dispose();
});

function occluderScene(){
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0,-0.2,-0.2,-2,0.2,-0.2,-2,0.2,0.2,-2,-0.2,0.2,-2],3));
 geometry.setIndex([0,1,2,0,2,3,4,5,6,4,6,7]);
 const material=new THREE.MeshBasicMaterial({color:0xff0000}),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=[
  {id:0,url:'front',count:6,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:24,sha256:'x'},
  {id:1,url:'back',count:6,min:[-0.2,-0.2,-2] as number[],max:[0.2,0.2,-2] as number[],bytes:24,sha256:'x'},
 ];
 const metadata={primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,hierarchy:{min:[-1,-1,-2],max:[1,1,0],children:pages.map(p=>({min:p.min,max:p.max,page:p.id}))}}]};
 const indices=new Map([['front',new Uint32Array([0,1,2,0,2,3])],['back',new Uint32Array([4,5,6,4,6,7])]]);
 const associations=new Map([[mesh,{meshes:0,primitives:0}]]);
 return {geometry,material,source,metadata,indices,associations};
}

test('GPU Hi-Z builds the pyramid after the vis occluder pass and loads the disoccluded vis pass',async()=>{
 installGpuGlobals();
 const {source,metadata,indices,associations,geometry,material}=occluderScene();
 const viewport:[number,number]=[32,32];
 const collected=collectClusterPages(source,metadata,indices,associations);
 const {device,passes,computes,textures}=mockGpu(undefined,packSelectionForest(collected.roots),false,false,false,true);
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:4,viewport});
 const cam=camera();
 const cpu=selectVisiblePages(collected.roots,cam,{pixelError:0,viewport,frame:1});
 await backend.prepare();
 assert.equal(backend.capabilities.unsupported.includes('occlusion culling'),false);
 assert.ok(textures.some(texture=>texture.format==='r32float'));
 backend.render(cam);await backend.flush();
 backend.render(cam);
 const visPasses=passes.filter(pass=>pass.depthLoad);
 assert.ok(visPasses.length>=2);
 assert.equal(visPasses[visPasses.length-2]?.colorLoad,'clear');
 assert.equal(visPasses[visPasses.length-2]?.depthLoad,'clear');
 assert.equal(visPasses[visPasses.length-1]?.colorLoad,'load');
 assert.equal(visPasses[visPasses.length-1]?.depthLoad,'load');
 assert.ok(visPasses[visPasses.length-2]?.colorCount>=2);
 assert.ok(computes.includes('copyDepth'));
 assert.ok(computes.includes('reduceHiz'));
 assert.ok(computes.includes('testHiz'));
 assert.deepEqual(backend.selectedPageIds().sort(),cpu.shown.map(page=>page.url).sort());
 const visPages=cpu.shown.filter(page=>page.array).map(page=>({...page,array:page.array!}));
 assert.equal(compareImages(backend.rasterRgba(),shadeVisibility(rasterVisibilityIds(visPages,cam,viewport),visPages,cam,viewport)).maxChannelError,0);
 const drawn=new Set([...backend.visibilityIds()].flatMap(id=>{const unpacked=unpackVisibilityId(id);return unpacked?[unpacked.pageIndex]:[];}));
 assert.deepEqual([...drawn].sort(),[0]);
 backend.dispose();geometry.dispose();material.dispose();
});



