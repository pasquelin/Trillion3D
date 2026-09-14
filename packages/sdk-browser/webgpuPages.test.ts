import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from 'three';
import {compareImages} from '../sdk-core/index.ts';
import {presentationColorDiagnostic} from './index.ts';
import {exactPagesBackend} from './index.ts';
import {outputColorDiagnostic,webgpuPagesBackend} from './webgpuPages.ts';
import {rasterPageRecords} from './pageRaster.ts';
import {collectClusterPages,selectVisiblePages} from './pageSelection.ts';
import {evaluateDagSelectionKernel,packDagSelection,type PackedDag} from './gpuDagSelection.ts';
import {evaluateDrawCompact,indirectForDraw,PAGE_BIND_ALIGN,type DrawItem} from './gpuDraw.ts';
import {PAGE_INFO_STRIDE,rasterVisibilityIds,shadeVisibility,unpackVisibilityId} from './visibilityBuffer.ts';


function installGpuGlobals(){
 Object.assign(globalThis,{
  GPUBufferUsage:{MAP_READ:1,MAP_WRITE:2,COPY_SRC:4,COPY_DST:8,INDEX:16,VERTEX:32,UNIFORM:64,STORAGE:128,INDIRECT:256,QUERY_RESOLVE:512},
  GPUTextureUsage:{COPY_SRC:1,COPY_DST:2,TEXTURE_BINDING:4,STORAGE_BINDING:8,RENDER_ATTACHMENT:16},
  GPUShaderStage:{VERTEX:1,FRAGMENT:2,COMPUTE:4},
  GPUMapMode:{READ:1,WRITE:2},
 });
}

test('the GPU readback diagnostic distinguishes the requested clear color from the rendered pixels',()=>{
 const pixels=new Uint8Array([
  42,48,60,255, 1,2,3,255,
  4,5,6,255, 7,8,9,255,
 ]);
 assert.deepEqual(outputColorDiagnostic(pixels,2,2,0x2a303c),{
  clearColor:'#2a303c',
  topLeft:'#2a303c',
  center:'#070809',
  matchesClearAtTopLeft:true,
 });
});

test('the presentation diagnostic exposes the final capture pixel separately from the WebGPU target',()=>{
 const pixels=new Uint8Array([
  42,48,60,255, 1,2,3,255,
  4,5,6,255, 7,8,9,255,
 ]);
 assert.deepEqual(presentationColorDiagnostic(pixels,2,2,0x2a303c),{
  clearColor:'#2a303c',
  topLeft:'#2a303c',
  center:'#070809',
  matchesClearAtTopLeft:true,
  surface:'webgl-capture-target',
 });
});

test('the presentation diagnostic identifies a pixel read from the visible WebGL framebuffer',()=>{
 const pixels=new Uint8Array([42,48,60,255]);
 assert.deepEqual(presentationColorDiagnostic(pixels,1,1,0x2a303c,'default-webgl-framebuffer'),{
  clearColor:'#2a303c',
  topLeft:'#2a303c',
  center:'#2a303c',
  matchesClearAtTopLeft:true,
  surface:'default-webgl-framebuffer',
 });
});

test('WebGPU forwards its internal color diagnostics to the host report sink',async()=>{
 installGpuGlobals();
 const events:Array<{phase:string;message:string;context:Record<string,unknown>}>=[];
 const {device}=mockGpu();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32],clearColor:0x2a303c,onDiagnostic:event=>events.push(event)});
 assert.deepEqual(events[0],{phase:'clear-color-input',message:'Couleur de fond reçue par WebGeometry WebGPU',context:{pipelineVersion:1,clearColor:'#2a303c',value:0x2a303c,source:'hôte'}});
 await backend.prepare();
 backend.render(camera());
 assert.ok(events.some(event=>event.phase==='first-render-path'));
 backend.dispose();geometry.dispose();material.dispose();
});

test('trace diagnostics retain one bounded snapshot for every rendered frame',async()=>{
 installGpuGlobals();
 const events:Array<{phase:string;message:string;context:Record<string,unknown>}> = [];
 const fixture=quadScene();
 const collected=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 const {device}=mockGpu(undefined,packDagSelection(collected.roots));
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32],diagnosticDetail:'trace' as never,onDiagnostic:event=>events.push(event)} as never);
 try{
  await backend.prepare();
  backend.render(camera());await backend.flush();
  backend.render(camera());await backend.flush();
  const frames=events.filter(event=>event.phase==='frame');
  assert.equal(frames.length,2);
  assert.deepEqual(frames.map(event=>event.context.frame),[1,2]);
  assert.ok(frames.every(event=>typeof event.context.submission==='number'));
  assert.ok(frames.every(event=>event.context.coverage&&typeof event.context.coverage==='object'));
  assert.equal(events.filter(event=>event.phase==='cpu-selection').length,0);
  assert.ok(events.some(event=>event.phase==='residency-queue'));
  for(const phase of ['cpu-lights','gpu-selection-current-frame'])assert.ok(events.some(event=>event.phase===phase),phase);
 }finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('summary diagnostics keep frame traces disabled',async()=>{
 installGpuGlobals();
 const events:Array<{phase:string;message:string;context:Record<string,unknown>}> = [];
 const fixture=quadScene();
 const {device}=mockGpu();
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32],diagnosticDetail:'summary' as never,onDiagnostic:event=>events.push(event)} as never);
 try{await backend.prepare();backend.render(camera());await backend.flush();assert.equal(events.some(event=>event.phase==='frame'),false);}
 finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('trace failure diagnostics retain bounded stack and cause context',async()=>{
 installGpuGlobals();
 const events:Array<{phase:string;message:string;context:Record<string,unknown>}> = [];
 const fixture=quadScene(),{device}=mockGpu();
 const backend=webgpuPagesBackend({...fixture,indices:new Map(),readPage:async()=>{throw new Error('PAGE_STREAM_FAILED',{cause:new Error('NETWORK_ROOT')});},gpuDevice:device,maxResidentPages:2,viewport:[32,32],onDiagnostic:event=>events.push(event)} as never);
 try{await assert.rejects(backend.prepare(),/PAGE_STREAM_FAILED/);await Promise.resolve();const failure=events.find(event=>event.phase==='coverage-bootstrap-failed');assert.ok(failure);assert.match(String(failure.context.stack),/Error: PAGE_STREAM_FAILED/);assert.match(String(failure.context.cause),/NETWORK_ROOT/);}
 finally{await backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

/** `writeBuffer`'s window: `dataOffset` and `size` count elements of `data`, bytes for an ArrayBuffer. */
function bytesOf(data:BufferSource,dataOffset=0,size?:number){
 if(data instanceof ArrayBuffer)return new Uint8Array(data,dataOffset,size??data.byteLength-dataOffset);
 const view=data as ArrayBufferView,element=(view as {BYTES_PER_ELEMENT?:number}).BYTES_PER_ELEMENT??1;
 const start=view.byteOffset+dataOffset*element;
 return new Uint8Array(view.buffer,start,size===undefined?view.byteLength-dataOffset*element:size*element);
}

function mockGpu(limits:Record<string,number>={maxBufferSize:1<<20,maxStorageBufferBindingSize:1<<20},packed?:PackedDag,failMap=false,rejectR32=false,failVisPass=false,enableHiz=false,failCompact=false){
 const draws:Array<{vertexCount:number;instanceCount?:number;firstInstance?:number;bindOffset?:number;instanceBuffer?:unknown;slotOffsetsBuffer?:unknown;indirect?:boolean;entryPoint?:string}>=[],writes:Array<{offset:number;bytes:Uint8Array;label?:string;seq:number}>=[];
 // One counter over writes and submits: a row has to reach the GPU before the image that reads it.
 const buffers:Array<{label?:string;size:number;data:Uint8Array}>=[],submits:number[]=[];
 let seq=0;
 const textures:Array<{format?:string;usage?:number;depthOrArrayLayers:number;views:Array<{dimension?:string}|undefined>}>=[];
 const passes:Array<{label?:string;colorLoad?:string;colorClear?:GPUColor;depthLoad?:string;colorCount:number;formats:string[]}>=[];
 const computes:string[]=[];
 const imageCopies:unknown[]=[];
 const layouts:Array<{entries:Array<{binding:number;buffer?:{type?:string}}>}>=[];
 let lostResolve:((info:{reason:string;message:string})=>void)|undefined;
 const lost=new Promise<{reason:string;message:string}>(resolve=>{lostResolve=resolve;});
 let currentRenderEntry='';
 let currentBind:unknown,computeBind:{entries:Array<{binding:number;resource:{buffer:{data:Uint8Array}}}>}|undefined,computePipeline:{entryPoint:string}|undefined,visPassFails=failVisPass;
 const device:{[key:string]:unknown}={
  limits,lost,
  createBuffer:({size,usage,label}:{size:number;usage:number;label?:string})=>{
   const data=new Uint8Array(size);
   const buffer={size,usage,label,data,destroy(){},mapAsync:async()=>{if(failMap&&label!=='WG explicit capture')throw new Error('MAP_FAILED');},getMappedRange:()=>data.buffer,unmap(){}};
   buffers.push(buffer);return buffer;
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
  createRenderPipeline:(desc:{vertex?:{entryPoint?:string};fragment?:{targets?:Array<{format?:string}>}})=>{
   if(rejectR32&&desc.fragment?.targets?.[0]?.format==='r32uint')throw new Error('NO_R32UINT');
   return {entryPoint:desc.vertex?.entryPoint};
  },
  createBindGroup:(desc:unknown)=>desc,
  createCommandEncoder:()=>({
   beginRenderPass:(desc?:{label?:string;colorAttachments?:Array<{loadOp?:string;clearValue?:GPUColor;view?:{format?:string}}>;depthStencilAttachment?:{depthLoadOp?:string}})=>{
    if(visPassFails&&desc?.label==='WG visibility primary'){visPassFails=false;throw new Error('VIS_FAIL');}
    const colors=desc?.colorAttachments??[];
    passes.push({label:desc?.label,colorLoad:colors[0]?.loadOp,colorClear:colors[0]?.clearValue,depthLoad:desc?.depthStencilAttachment?.depthLoadOp,colorCount:colors.length,formats:colors.map(color=>color.view?.format??'')});
    return {
    setPipeline(pipeline:{entryPoint?:string}){currentRenderEntry=pipeline.entryPoint??'';},setBindGroup(_i:number,group:unknown){currentBind=group;},setViewport(){},
    draw(vertexCount:number,instanceCount=1,_firstVertex=0,firstInstance=0){draws.push({vertexCount,instanceCount,firstInstance,entryPoint:currentRenderEntry});void currentBind;},
    drawIndirect(buffer:{data?:Uint8Array}, offset:number){
      const words=new Uint32Array(buffer.data!.buffer, buffer.data!.byteOffset+offset, 4);
      const entries=(currentBind as {entries?:Array<{binding:number;resource:{offset?:number}}>} | undefined)?.entries;
      const page=entries?.find(entry=>entry.binding===2);
      const instances=entries?.find(entry=>entry.binding===8),offsets=entries?.find(entry=>entry.binding===9);
      draws.push({vertexCount:words[0], instanceCount:words[1], firstInstance:words[3], bindOffset:page?.resource?.offset??0, instanceBuffer:instances?.resource,slotOffsetsBuffer:offsets?.resource, indirect:true,entryPoint:currentRenderEntry});
    },
    end(){},
   };},
   beginComputePass:()=>({
    setPipeline(next:{entryPoint:string}){computePipeline=next;},
    setBindGroup(_i:number,group:typeof computeBind){computeBind=group;},
    dispatchWorkgroupsIndirect(){if(computePipeline?.entryPoint)computes.push(computePipeline.entryPoint);},
    dispatchWorkgroups(){
     if(computePipeline?.entryPoint)computes.push(computePipeline.entryPoint);
     if(computePipeline?.entryPoint==='scatterGroups'&&computeBind){
      const byBinding=new Map(computeBind.entries.map(entry=>[entry.binding,entry.resource.buffer]));
      const uniBytes=byBinding.get(1)!.data;
      const uni=new Uint32Array(uniBytes.buffer,uniBytes.byteOffset,uniBytes.byteLength/4);
      const count=uni[0],maxVertexCount=uni[1],slotCap=uni[2];
      const itemBytes=byBinding.get(0)!.data;
      const itemInts=new Uint32Array(itemBytes.buffer,itemBytes.byteOffset,itemBytes.byteLength/4);
      const n=Math.min(count,slotCap);
      const restBytes=byBinding.get(7)!.data;
      const restInts=new Uint32Array(restBytes.buffer,restBytes.byteOffset,restBytes.byteLength/4);
      const restAt=(i:number)=>((restInts[i>>5]>>(i&31))&1) as 0|1;
      const items:DrawItem[]=[];
      for(let i=0;i<n;i++)items.push({pageIndex:itemInts[i*4],bin:itemInts[i*4+1] as 0|1|2,rest:restAt(i)});
      const source=count>slotCap?items.concat(Array.from({length:count-n},()=>({pageIndex:0,bin:0 as const,rest:0 as const}))):items;
      const maskBytes=byBinding.get(6)?.data;
      const mask=maskBytes?new Uint32Array(maskBytes.buffer):undefined;
      const filtered=uni[4]&&mask?source.filter((_,i)=>mask[uni[5]+itemInts[i*4+2]]!==0):source;
      const result=evaluateDrawCompact(count>slotCap?source:filtered,maxVertexCount,slotCap);
      const offsets=byBinding.get(5)!.data;
      new Uint32Array(offsets.buffer).set(Array.from({length:6},(_,slot)=>result.indirect[slot*4+3]));
      const instBytes=byBinding.get(2)!.data;
      new Uint32Array(instBytes.buffer,instBytes.byteOffset,instBytes.byteLength/4).set(result.instances);
      const indBytes=byBinding.get(3)!.data;
      new Uint32Array(indBytes.buffer,indBytes.byteOffset,indBytes.byteLength/4).set(indirectForDraw(result));
      return;
     }
     if(!packed||computePipeline?.entryPoint!=='dagMask'||!computeBind)return;
     const byBinding=new Map(computeBind.entries.map(entry=>[entry.binding,entry.resource.buffer]));
     const data=byBinding.get(2)!.data;
     const f32=new Float32Array(data.buffer,data.byteOffset,data.byteLength/4);
     const uniInts=new Uint32Array(data.buffer);
     const uniforms={
      planes:f32.slice(0,24),view:f32.slice(24,40),pixelScale:[f32[40],f32[41]] as [number,number],pixelError:f32[42],near:f32[43],
      cameraWorld:[f32[48],f32[49],f32[50]] as [number,number,number],cameraStretch:f32[51],
     };
     const residentCut=!!uniInts[47];
     const cones=new Float32Array(byBinding.get(8)!.data.buffer);
     const resident=residentCut?Uint32Array.from({length:packed.pageCount},(_,i)=>cones[i*12+11]):undefined;
     const result=evaluateDagSelectionKernel(packed,uniforms,resident);
     if(residentCut){
      const flags=new Uint32Array(byBinding.get(3)!.data.buffer);flags.fill(0,packed.nodeCount);
      for(const id of result.drawablePageIds??[])flags[packed.nodeCount+id]=1;
     }
     const out=byBinding.get(4)!.data;
     const ints=new Uint32Array(out.buffer,out.byteOffset,out.byteLength/4);
     ints[0]=result.pageIds.length;ints[1]=result.frustumRejected;ints[2]=result.lodLevel;ints[3]=result.complete===false?2:0;ints.set(result.pageIds,4);
    },
    end(){},
   }),
   clearBuffer(buffer:{data?:Uint8Array},offset=0,size?:number){buffer.data?.fill(0,offset,size===undefined?buffer.data.length:offset+size);},
   copyBufferToBuffer(src:{data?:Uint8Array},s:number,dst:{data?:Uint8Array},d:number,size:number){if(src.data&&dst.data)dst.data.set(src.data.subarray(s,s+size),d);},
   copyTextureToBuffer(...args:unknown[]){imageCopies.push(args);},
   copyTextureToTexture(){},
   finish:()=>({}),
  }),
  queue:{
   writeBuffer(buffer:{data?:Uint8Array;label?:string},offset:number,data:BufferSource,dataOffset?:number,size?:number){
    const bytes=bytesOf(data,dataOffset,size);writes.push({offset,bytes:new Uint8Array(bytes),label:buffer.label,seq:seq++});buffer.data?.set(bytes,offset);
   },
   writeTexture(){},
   submit(){submits.push(seq++);},
   onSubmittedWorkDone:async()=>{},
  },
 };
 if(packed||enableHiz)device.createComputePipeline=({compute}:{compute:{entryPoint:string}})=>{
  if(failCompact&&compute.entryPoint==='scatterGroups')throw new Error('NO_COMPACT');
  return compute;
 };
 return {device:device as unknown as GPUDevice,draws,writes,buffers,submits,textures,passes,computes,layouts,imageCopies,lose:(reason='destroyed')=>lostResolve?.({reason,message:reason})};
}

/** The screen-error band every cluster of a DAG cache carries, derived from its own box. */
function clusterSphere(page:{min:number[];max:number[]}){
 const c=[0,1,2].map(i=>(page.min[i]+page.max[i])/2);
 return [...c,Math.hypot(...[0,1,2].map(i=>page.max[i]-c[i]))||1];
}
/** Level-0 clusters that nothing replaces: the smallest legal DAG, one root per cluster. */
function dagRoots<T extends {id:number;min:number[];max:number[]}>(pages:T[]){
 return pages.map(page=>({...page,role:'exact' as const,start:page.id*3,level:0,lodError:0,
  sphere:clusterSphere(page),parentError:null,parentSphere:null,group:null,source:null}));
}
/** `leaves` replaced by one coarse cluster of error `error`: the smallest two-level DAG. */
function dagLevel<T extends {id:number;min:number[];max:number[]}>(leaves:T[],coarse:T,error:number){
 const sphere=clusterSphere(coarse);
 return {
  pages:[
   ...leaves.map(page=>({...page,role:'exact' as const,start:page.id*3,level:0,lodError:0,
    sphere:clusterSphere(page),parentError:error,parentSphere:sphere,group:0,source:null})),
   {...coarse,role:'coarse' as const,start:0,level:1,lodError:error,sphere,parentError:null,parentSphere:null,group:null,source:0},
  ],
  structure:{version:1,roots:[coarse.id],groups:[{level:1,error,sphere,children:leaves.map(page=>page.id),outputs:[coarse.id]}]},
 };
}

function quadScene(){
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
 const material=new THREE.MeshBasicMaterial({color:0xff0000}),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=dagRoots([0,1].map(id=>({id,url:String(id),count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x'})));
 const metadata={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups',primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,structure:{version:1,roots:[0,1],groups:[]}}]};
 const indices=new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])]]);
 const associations=new Map([[mesh,{meshes:0,primitives:0}]]);
 return {geometry,material,source,pages,metadata,indices,associations};
}

function camera(){
 const cam=new THREE.PerspectiveCamera(55,1,.1,100);cam.position.z=5;cam.lookAt(0,0,0);cam.updateMatrixWorld();return cam;
}

test('texture uploads obey the per-frame source-byte budget, and a flush settles the whole queue',async()=>{
 installGpuGlobals();const {device}=mockGpu();const fixture=quadScene();
 const color=new THREE.DataTexture(new Uint8Array(16).fill(255),2,2),normal=new THREE.DataTexture(new Uint8Array(16).fill(128),2,2);
 const rough=new THREE.DataTexture(new Uint8Array(16).fill(64),2,2),emissive=new THREE.DataTexture(new Uint8Array(16).fill(32),2,2);
 const material=new THREE.MeshStandardMaterial({map:color,normalMap:normal,roughnessMap:rough,emissiveMap:emissive});fixture.source.children[0].material=material;
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32],maxTextureTransferBytesPerFrame:16});
 try{
  // One layer per frame is the budget a render is allowed to spend; it advances by exactly one.
  await backend.prepare();assert.equal(backend.metrics().textureUploaded,1);assert.equal(backend.metrics().texturePending,3);
  // The readiness barrier drains the rest, so two renders of one camera cannot differ because a
  // material layer landed between them.
  backend.render(camera());await backend.flush();
  assert.equal(backend.metrics().texturePending,0);assert.equal(backend.metrics().textureUploaded,4);
 }finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();material.dispose();color.dispose();normal.dispose();rough.dispose();emissive.dispose();}
});

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
 const {device,draws,writes}=mockGpu(undefined,packDagSelection(collected.roots));
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 backend.render(camera());
 await backend.flush?.();
 draws.length=0;backend.render(camera());
 let pageMeshes=0;backend.scene.traverse(o=>{if((o as THREE.Mesh).isMesh&&!(o as THREE.Mesh).userData.blit)pageMeshes++;});
 assert.equal(pageMeshes,0);
 assert.equal(backend.metrics().clusters,2);
 assert.equal(backend.metrics().selectedTriangles,2);
 assert.equal(backend.metrics().residentPages,2);
 assert.ok(writes.length>=2);
 const vis = draws.filter(d => d.indirect);
 const shade = draws.filter(d => d.entryPoint==='shade_vs');
 assert.equal(shade.reduce((n,d)=>n+d.vertexCount,0), 3);
 assert.ok(vis.length >= 1 && vis.length <= 6);
 assert.equal(vis.reduce((n,d)=>n+(d.instanceCount??0),0), 2);
 assert.ok(vis.every(d=>d.firstInstance===0));
 assert.ok(vis.every(d=>((d.bindOffset??0)%PAGE_BIND_ALIGN)===0));
 assert.equal(backend.capabilities.unsupported.includes('visibility buffer'),false);
 backend.dispose();geometry.dispose();material.dispose();
});

function mixedBinScene(){
 const geoA=new THREE.BufferGeometry();geoA.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0],3));geoA.setIndex([0,1,2]);
 const geoB=new THREE.BufferGeometry();geoB.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,1,0,-1,1,0],3));geoB.setIndex([0,1,2]);
 const front=new THREE.MeshBasicMaterial({color:0xff0000,side:THREE.FrontSide}),both=new THREE.MeshBasicMaterial({color:0x00ff00,side:THREE.DoubleSide});
 const meshA=new THREE.Mesh(geoA,front),meshB=new THREE.Mesh(geoB,both),source=new THREE.Group();source.add(meshA,meshB);
 const pagesA=dagRoots([{id:0,url:'0',count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x'}]);
 const pagesB=dagRoots([{id:0,url:'1',count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x'}]);
 const structure={version:1,roots:[0],groups:[]};
 const metadata={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups',primitives:[
  {mesh:0,primitive:0,pass:'exact-clusters',pages:pagesA,structure},
  {mesh:1,primitive:0,pass:'exact-clusters',pages:pagesB,structure},
 ]};
 const indices=new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,1,2])]]);
 const associations=new Map([[meshA,{meshes:0,primitives:0}],[meshB,{meshes:1,primitives:0}]]);
 return {geoA,geoB,front,both,source,metadata,indices,associations};
}

test('vis drawIndirect consumes GPU instance indices against one unsorted page table',async()=>{
 installGpuGlobals();
 const {source,metadata,indices,associations,geoA,geoB,front,both}=mixedBinScene();
 const collected=collectClusterPages(source,metadata,indices,associations);
 const {device,draws}=mockGpu(undefined,packDagSelection(collected.roots));
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 backend.render(camera());
 await backend.flush?.();
 draws.length=0;backend.render(camera());
 const vis=draws.filter(draw=>draw.indirect);
 assert.ok(vis.length>=2&&vis.length<=6);
 assert.equal(vis.reduce((n,draw)=>n+(draw.instanceCount??0),0),2);
 assert.ok(vis.every(draw=>draw.firstInstance===0));
 assert.ok(vis.every(draw=>((draw.bindOffset??0)%PAGE_BIND_ALIGN)===0));
 const offsets=new Set(vis.map(draw=>draw.bindOffset??0));
 assert.ok(offsets.has(0));
 assert.deepEqual([...offsets],[0],'all bins share the original page table');
 assert.ok(vis.every(draw=>draw.instanceBuffer&&draw.slotOffsetsBuffer),'GPU redistribution is bound to the vertex shader');
 backend.dispose();geoA.dispose();geoB.dispose();front.dispose();both.dispose();
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
 await assert.rejects(backend.prepare(),/INITIAL_COVERAGE_BUDGET/);
 assert.equal(draws.length,0);
 backend.dispose();geometry.dispose();material.dispose();
});

test('the initial cover also protects regions first discovered after a camera jump',async()=>{
 installGpuGlobals();
 const {device}=mockGpu();
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0,100,-1,0,102,-1,0,102,1,0],3));geometry.setIndex([0,1,2,0,2,3,4,5,6]);
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=dagRoots([
  {id:0,url:'0',count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x'},
  {id:1,url:'1',count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x'},
  {id:2,url:'2',count:3,min:[100,-1,0] as number[],max:[102,1,0] as number[],bytes:12,sha256:'x'},
 ]);
 const metadata={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups',primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,structure:{version:1,roots:[0,1,2],groups:[]}}]};
 const indices=new Map([['0',new Uint32Array([0,1,2])],['1',new Uint32Array([0,2,3])],['2',new Uint32Array([4,5,6])]]);
 const backend=webgpuPagesBackend({source,metadata,indices,associations:new Map([[mesh,{meshes:0,primitives:0}]]),gpuDevice:device,maxResidentPages:3,viewport:[32,32]});
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
 assert.equal(backend.metrics().residentPages,1);
 assert.equal(backend.metrics().cacheEvictions,0);
 assert.equal(backend.overBudget,false);
 backend.dispose();geometry.dispose();material.dispose();
});

test('webgpu pages select the same coarse LOD cut as the WebGL2 exact backend',async()=>{
 installGpuGlobals();
 const {device}=mockGpu();
 const {source,metadata:base,indices,associations,geometry,material}=quadScene();
 const leaf=(id:number)=>({id,url:String(id),count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x'});
 // Screen error 0.001 on the coarse cluster: at pixelError 10 the coarse cover wins everywhere.
 const level=dagLevel([leaf(0),leaf(1)],leaf(2),0.001);
 const metadata={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups',primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...level}]};
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

test('webgpu pages never publish an incomplete initial cover',async()=>{
 installGpuGlobals();
 const {device,draws}=mockGpu();
 const {source,metadata,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices:new Map(),associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 backend.render(camera());
 assert.equal(draws.filter(draw=>draw.entryPoint==='vis_vs'||draw.entryPoint==='vs').length,0);
 backend.acceptPage?.('0',new Uint32Array([0,1,2]));
 backend.render(camera());
 await backend.flush?.();
 backend.render(camera());
 assert.equal(backend.metrics().clusters,2);
 assert.equal(backend.metrics().residentPages,0);
 assert.equal(backend.metrics().coverageReady,false);
 assert.equal(draws.length,0);
 backend.acceptPage?.('1',new Uint32Array([0,2,3]));await backend.flush();backend.render(camera());
 assert.equal(backend.metrics().coverageReady,true);assert.equal(backend.metrics().residentPages,2);
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
 assert.equal(draws.filter(draw=>draw.entryPoint==='vis_vs'||draw.entryPoint==='vs').length,0);
 backend.acceptPage?.('0',new Uint32Array([0,1,2]));
 backend.acceptPage?.('1',new Uint32Array([0,2,3]));
 backend.render(camera());
 await backend.flush?.();
 backend.render(camera());
 assert.equal(backend.metrics().residentPages,2);
 assert.equal(draws.filter(draw=>draw.entryPoint==='vis_vs').reduce((n,d)=>n+d.vertexCount,0),6);
 backend.dispose();geometry.dispose();material.dispose();
});

test('webgpu pages without a device fail prepare so the explorer can keep the Three.js path',async()=>{
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices,associations,maxResidentPages:2,viewport:[32,32]});
 await assert.rejects(backend.prepare(),/WEBGPU_UNAVAILABLE/);
 backend.dispose();geometry.dispose();material.dispose();
});

test('the direct WebGPU fallback uses the scene background supplied by its host',async()=>{
 installGpuGlobals();
 const {device,passes}=mockGpu(undefined,undefined,false,true);
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32],clearColor:0x2d4059});
 await backend.prepare();
 backend.render(camera());
 await backend.flush?.();
 backend.render(camera());
 const clear=passes.findLast(pass=>pass.colorLoad==='clear'&&pass.formats[0]==='rgba8unorm')?.colorClear;
 assert.deepEqual(clear,{r:0x2d/255,g:0x40/255,b:0x59/255,a:1});
 backend.dispose();geometry.dispose();material.dispose();
});

test('the visibility-buffer path also clears with the host scene background',async()=>{
 installGpuGlobals();
 const {device,passes}=mockGpu();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32],clearColor:0x2d4059});
 await backend.prepare();
 backend.render(camera());
 await backend.flush?.();
 backend.render(camera());
 const clears=passes.filter(pass=>pass.colorLoad==='clear'&&pass.formats[0]==='rgba8unorm').map(pass=>pass.colorClear);
 assert.ok(clears.length>0);
 assert.ok(clears.some(clear=>JSON.stringify(clear)===JSON.stringify({r:0x2d/255,g:0x40/255,b:0x59/255,a:1})));
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
 const packed=packDagSelection(collected.roots);
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
 const leaf=(id:number)=>({id,url:String(id),count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x'});
 // Screen error 0.001 on the coarse cluster: at pixelError 10 the coarse cover wins everywhere.
 const level=dagLevel([leaf(0),leaf(1)],leaf(2),0.001);
 const metadata={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups',primitives:[{mesh:0,primitive:0,pass:'exact-clusters',...level}]};
 const allIndices=new Map([...indices,['2',new Uint32Array([0,1,2])]]);
 const viewport:[number,number]=[960,540];
 const collected=collectClusterPages(source,metadata,allIndices,associations);
 const packed=packDagSelection(collected.roots);
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
 const pagesA=dagRoots([{id:0,url:'orphan',count:3,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:12,sha256:'x'}]);
 const pagesB=dagRoots([{id:0,url:'exact',count:3,min:[8,-1,0] as number[],max:[10,1,0] as number[],bytes:12,sha256:'x'}]);
 const structure={version:1,roots:[0],groups:[]};
 const metadata={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups',primitives:[
  {mesh:0,primitive:0,pass:'exact-clusters',pages:pagesA,structure},
  {mesh:1,primitive:0,pass:'exact-clusters',pages:pagesB,structure},
 ]};
 const indices=new Map([['orphan',new Uint32Array([0,1,2])],['exact',new Uint32Array([0,1,2])]]);
 const associations=new Map([[meshA,{meshes:0,primitives:0}],[meshB,{meshes:1,primitives:0}]]);
 const collected=collectClusterPages(source,metadata,indices,associations);
 const packed=packDagSelection(collected.roots);
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
 const packed=packDagSelection(collected.roots);
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
 const pages=dagRoots([
  {id:0,url:'front',count:6,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:24,sha256:'x'},
  {id:1,url:'back',count:6,min:[-0.2,-0.2,-2] as number[],max:[0.2,0.2,-2] as number[],bytes:24,sha256:'x'},
 ]);
 const metadata={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups',primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,structure:{version:1,roots:[0,1],groups:[]}}]};
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
 const events:Array<{phase:string;context:Record<string,unknown>}>=[];
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32],onDiagnostic:event=>events.push(event)});
 await backend.prepare();
 assert.equal(backend.capabilities.unsupported.includes('occlusion culling'),false);
 const cam=camera();
 backend.render(cam);await backend.flush();
 backend.render(cam);
 assert.equal(backend.capabilities.unsupported.includes('occlusion culling'),true);
 assert.equal(backend.capabilities.unsupported.includes('visibility buffer'),true);
 backend.render(cam);
 const failures=events.filter(event=>event.phase==='visibility-render-failed');
 assert.equal(failures.length,1,'a repeated fallback must not flood diagnostic logs');
 assert.equal(typeof failures[0].context.error,'string');
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
 backend.render(camera());await backend.flush();draws.length=0;backend.render(camera());
 assert.deepEqual(backend.selectedPageIds().sort(),['0','1']);
 assert.equal(draws.reduce((n,d)=>n+d.vertexCount,0),6);
 backend.dispose();geometry.dispose();material.dispose();
});

function occluderScene(){
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0,-0.2,-0.2,-2,0.2,-0.2,-2,0.2,0.2,-2,-0.2,0.2,-2],3));
 geometry.setIndex([0,1,2,0,2,3,4,5,6,4,6,7]);
 const material=new THREE.MeshBasicMaterial({color:0xff0000}),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const pages=dagRoots([
  {id:0,url:'front',count:6,min:[-1,-1,0] as number[],max:[1,1,0] as number[],bytes:24,sha256:'x'},
  {id:1,url:'back',count:6,min:[-0.2,-0.2,-2] as number[],max:[0.2,0.2,-2] as number[],bytes:24,sha256:'x'},
 ]);
 const metadata={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups',primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages,structure:{version:1,roots:[0,1],groups:[]}}]};
 const indices=new Map([['front',new Uint32Array([0,1,2,0,2,3])],['back',new Uint32Array([4,5,6,4,6,7])]]);
 const associations=new Map([[mesh,{meshes:0,primitives:0}]]);
 return {geometry,material,source,metadata,indices,associations};
}

test('GPU Hi-Z builds the pyramid after the vis occluder pass and loads the disoccluded vis pass',async()=>{
 installGpuGlobals();
 const {source,metadata,indices,associations,geometry,material}=occluderScene();
 const viewport:[number,number]=[32,32];
 const collected=collectClusterPages(source,metadata,indices,associations);
 const {device,passes,computes,textures,draws}=mockGpu(undefined,packDagSelection(collected.roots),false,false,false,true);
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:4,viewport});
 const cam=camera();
 const cpu=selectVisiblePages(collected.roots,cam,{pixelError:0,viewport,frame:1});
 await backend.prepare();
 assert.equal(backend.capabilities.unsupported.includes('occlusion culling'),false);
 assert.ok(textures.some(texture=>texture.format==='r32float'));
 backend.render(cam);await backend.flush();
 draws.length=0;backend.render(cam);
 const visPasses=passes.filter(pass=>pass.label==='WG visibility primary'||pass.label==='WG visibility secondary');
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
 const vis=draws.filter(draw=>draw.indirect);
 assert.ok(vis.length>=1&&vis.length<=6);
 assert.ok(vis.every(draw=>draw.firstInstance===0));
 assert.ok(vis.every(draw=>((draw.bindOffset??0)%PAGE_BIND_ALIGN)===0));
 backend.dispose();geometry.dispose();material.dispose();
});

test('a successful vis+compact pipeline drops indirect draw from unsupported',async()=>{
 installGpuGlobals();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const collected=collectClusterPages(source,metadata,indices,associations);
 const {device}=mockGpu(undefined,packDagSelection(collected.roots),false,false,false,true);
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 assert.equal(backend.capabilities.unsupported.includes('indirect draw'),false);
 assert.equal(backend.capabilities.gpuDriven,true);
 backend.dispose();geometry.dispose();material.dispose();
});

test('a compact pipeline failure keeps the per-page draw loop',async()=>{
 installGpuGlobals();
 const {source,metadata,indices,associations,geometry,material}=quadScene();
 const collected=collectClusterPages(source,metadata,indices,associations);
 const {device,draws}=mockGpu(undefined,packDagSelection(collected.roots),false,false,false,true,true);
 const backend=webgpuPagesBackend({source,metadata,indices,associations,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 await backend.prepare();
 assert.equal(backend.capabilities.unsupported.includes('indirect draw'),true);
 backend.render(camera());
 await backend.flush?.();
 backend.render(camera());
 assert.equal(draws.filter(draw=>draw.indirect).length,0);
 backend.dispose();geometry.dispose();material.dispose();
});


test('normal GPU rendering never copies the image to CPU staging buffers',async()=>{
 installGpuGlobals();
 const {device,imageCopies}=mockGpu();const fixture=quadScene();
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 try{
  await backend.prepare();backend.render(camera());await backend.flush?.();
  imageCopies.length=0;
  for(let i=0;i<3;i++)backend.render(camera());
  assert.equal(imageCopies.length,0,'beauty must not enqueue image readback');
 }finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('opaque materials are rendered before lighting into reusable GPU surface textures',async()=>{
 installGpuGlobals();
 const {device,passes}=mockGpu();const fixture=quadScene();
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 try{
  await backend.prepare();backend.render(camera());await backend.flush?.();backend.render(camera());
  const surface=passes.findIndex(pass=>pass.formats.length===4&&pass.formats.at(-1)==='r32uint');
  const lighting=passes.findIndex((pass,i)=>i>surface&&pass.formats.length===1&&pass.formats[0]==='rgba16float');
  assert.ok(surface>=0,'material pass must write surface properties');
  assert.ok(lighting>surface,'lighting must consume the material pass');
  assert.equal(backend.metrics().vramBytes,null,'allocation arithmetic is not physical VRAM');
 }finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('surface capture uses its own camera and restores the main view without copying pixels to CPU',async()=>{
 installGpuGlobals();const {device,imageCopies}=mockGpu();const fixture=quadScene();
 const viewport:[number,number]=[32,32];
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport});
 try{
  await backend.prepare();const main=camera();backend.render(main);await backend.flush?.();backend.render(main);await backend.flush?.();
  const before=backend.capture!();const other=camera();other.position.x=1;other.lookAt(0,0,0);other.updateMatrixWorld();
  assert.equal(typeof backend.captureSurfaceView,'function');imageCopies.length=0;
  const surface=await backend.captureSurfaceView!(other,{width:16,height:16});
  assert.equal(surface.version,1);assert.deepEqual(surface.cameraWorld,[1,0,5]);assert.equal(surface.width,16);assert.equal(surface.selectedTriangles,2);
  assert.deepEqual(viewport,[32,32]);assert.deepEqual(main.position.toArray(),[0,0,5]);
  assert.equal(imageCopies.length,0,'secondary views must remain GPU textures');
  await assert.rejects(()=>backend.captureSurfaceView!(other,{width:16,height:16}),/SURFACE_CAPTURE_BUSY/);
  surface.dispose();await backend.flush?.();assert.deepEqual(backend.capture!(),before);
 }finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('explicit captures reject stale images and aborted surface captures leave the main view intact',async()=>{
 installGpuGlobals();const {device}=mockGpu();const fixture=quadScene();
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 try{
  await backend.prepare();backend.render(camera());await backend.flush?.();assert.equal(backend.capture!().length,4096);
  backend.render(camera());assert.throws(()=>backend.capture!(),/CAPTURE_NOT_READY/);
  assert.equal(typeof backend.captureSurfaceView,'function');
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>backend.captureSurfaceView!(camera(),{width:16,height:16,signal:controller.signal}),/abort/i);
  await backend.flush?.();assert.equal(backend.capture!().length,4096);
 }finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('surface capture rejects missing pages and a budget failure keeps the main viewport',async()=>{
 installGpuGlobals();const {device}=mockGpu();const fixture=quadScene();const viewport:[number,number]=[32,32];
 const backend=webgpuPagesBackend({...fixture,indices:new Map(),gpuDevice:device,maxResidentPages:2,viewport,maxFrameAllocationBytes:100000});
 try{
  await backend.prepare();backend.render(camera());
  await assert.rejects(()=>backend.captureSurfaceView!(camera(),{width:16,height:16}),/SURFACE_PAGES_NOT_RESIDENT/);
  assert.deepEqual(viewport,[32,32]);
  await assert.rejects(()=>backend.captureSurfaceView!(camera(),{width:100,height:100}),/SURFACE_BUDGET/);
  assert.deepEqual(viewport,[32,32]);backend.render(camera());
  assert.equal(backend.metrics().submittedTriangles,0);
 }finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('a host diagnostic exception cannot break GPU initialization or rendering',async()=>{
 installGpuGlobals();const {device}=mockGpu();const fixture=quadScene();
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32],onDiagnostic(){throw new Error('HOST_LOG_FAILURE');}});
 try{await backend.prepare();backend.render(camera());await backend.flush?.();backend.render(camera());assert.equal(backend.metrics().submittedTriangles,2);}
 finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('transparent frustum selection preserves intersections, transformed bounds and the opt-out',async()=>{
 installGpuGlobals();
 const cases=[
  {name:'in view',position:[0,0,0],visible:true},
  {name:'right',position:[100,0,0],visible:false},
  {name:'left',position:[-100,0,0],visible:false},
  {name:'above',position:[0,100,0],visible:false},
  {name:'below',position:[0,-100,0],visible:false},
  {name:'behind',position:[0,0,10],visible:false},
  {name:'past far plane',position:[0,0,-110],visible:false},
  {name:'partly in view',position:[3,0,0],visible:true},
  {name:'near plane intersection',position:[0,0,4.9],rotate:true,visible:true},
  {name:'mirrored nonuniform scale',position:[4,0,0],scale:[-4,2,1],visible:true},
  {name:'disabled culling',position:[100,0,0],unculled:true,visible:true},
 ];
 for(const item of cases){
  const fixture=quadScene(),{device,draws}=mockGpu(),mesh=fixture.source.children[0] as THREE.Mesh;
  fixture.metadata.primitives[0].pass='shared-blend';fixture.material.transparent=true;fixture.material.side=THREE.DoubleSide;
  mesh.position.fromArray(item.position);if(item.scale)mesh.scale.fromArray(item.scale);if(item.rotate)mesh.rotation.y=.5;mesh.frustumCulled=!item.unculled;fixture.source.updateMatrixWorld(true);
  const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
  try{
   await backend.prepare();backend.render(camera());
   const metrics=backend.metrics();
   assert.equal(metrics.submittedTriangles,item.visible?4:0,item.name);
   assert.equal(metrics.transparentMeshes,item.visible?1:0,item.name);
   assert.equal(metrics.transparentFrustumRejected,item.visible?0:1,item.name);
   assert.equal(metrics.transparentDrawCalls,item.visible?2:0,item.name);
   assert.equal(metrics.transparentSubmittedTriangles,item.visible?4:0,item.name);
   const actual=draws.filter(draw=>draw.entryPoint==='vs');
   assert.equal(actual.reduce((sum,draw)=>sum+draw.vertexCount/3,0),item.visible?4:0,item.name+' actual GPU commands');
  }finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
 }
});

test('transparent selection follows each camera without retaining an old rejected list',async()=>{
 installGpuGlobals();const fixture=quadScene(),{device}=mockGpu();fixture.metadata.primitives[0].pass='shared-blend';fixture.material.transparent=true;
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 try{await backend.prepare();const cam=camera();backend.render(cam);assert.equal(backend.metrics().submittedTriangles,2);cam.lookAt(100,0,5);cam.updateMatrixWorld();backend.render(cam);assert.equal(backend.metrics().submittedTriangles,0);cam.lookAt(0,0,0);cam.updateMatrixWorld();backend.render(cam);assert.equal(backend.metrics().submittedTriangles,2);}
 finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('mixed GPU and transparent pages wait for initial coverage before validating the resident cut',async()=>{
 installGpuGlobals();const fixture=quadScene(),blend=quadScene();
 const mesh=blend.source.children[0] as THREE.Mesh;fixture.source.add(mesh);blend.material.transparent=true;blend.material.side=THREE.DoubleSide;
 const primitive=blend.metadata.primitives[0];primitive.mesh=1;primitive.pass='clustered-blend';primitive.pages=primitive.pages.map(page=>({...page,url:`blend-${page.url}`}));
 fixture.metadata.primitives.push(primitive);fixture.associations.set(mesh,{meshes:1,primitives:0});
 for(const [url,array] of blend.indices)fixture.indices.set(`blend-${url}`,array);
 const collected=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 const {device}=mockGpu(undefined,packDagSelection(collected.roots.filter(root=>!root.pages[0].transparent)));
 const backend=webgpuPagesBackend({...fixture,indices:new Map(),gpuDevice:device,maxResidentPages:4,viewport:[32,32]});
 try{
  await backend.prepare();assert.equal(backend.capabilities.gpuDriven,true);
  assert.doesNotThrow(()=>backend.render(camera()));
  assert.equal(backend.metrics().coverageReady,false);
  assert.deepEqual(backend.pendingUrls?.().sort(),['0','1','blend-0','blend-1']);
  for(const [url,array] of fixture.indices)backend.acceptPage!(url,array);
  await backend.flush();backend.render(camera());await backend.flush();
  assert.equal(backend.metrics().coverageReady,true);
  assert.equal(backend.metrics().transparentSubmittedTriangles,4);
  assert.equal(backend.metrics().submittedTriangles,6);
 }finally{await backend.dispose();fixture.geometry.dispose();fixture.material.dispose();blend.geometry.dispose();blend.material.dispose();}
});

test('cached clustered cuts keep visibility current and leave unchanged mesh indices uploaded',async()=>{
 installGpuGlobals();const fixture=quadScene(),other=quadScene(),legacy=quadScene(),{device,writes}=mockGpu();
 fixture.material.transparent=true;fixture.material.side=THREE.DoubleSide;fixture.metadata.primitives[0].pass='clustered-blend';
 const mesh=fixture.source.children[0] as THREE.Mesh,legacyMesh=legacy.source.children[0] as THREE.Mesh;
 legacy.material.transparent=true;legacy.material.side=THREE.DoubleSide;
 legacy.metadata.primitives[0].mesh=1;legacy.metadata.primitives[0].pass='shared-blend';
 fixture.source.add(legacyMesh);fixture.metadata.primitives.push(legacy.metadata.primitives[0]);fixture.associations.set(legacyMesh,{meshes:1,primitives:0});
 const otherMesh=other.source.children[0] as THREE.Mesh;other.material.transparent=true;other.material.side=THREE.DoubleSide;
 const otherPrimitive=other.metadata.primitives[0];otherPrimitive.mesh=2;otherPrimitive.pass='clustered-blend';otherPrimitive.pages=otherPrimitive.pages.map(page=>({...page,url:`other-${page.url}`}));
 fixture.source.add(otherMesh);fixture.metadata.primitives.push(otherPrimitive);fixture.associations.set(otherMesh,{meshes:2,primitives:0});
 for(const [url,array] of other.indices)fixture.indices.set(`other-${url}`,array);
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:6,viewport:[32,32]});
 try{
  await backend.prepare();const cam=camera();backend.render(cam);
  assert.equal(backend.metrics().transparentSubmittedTriangles,12);
  const uploads=writes.length;
  otherMesh.position.x=100;backend.render(cam);
  assert.equal(backend.metrics().transparentSubmittedTriangles,8,'another paged mesh can disappear without changing this mesh cut');
  legacyMesh.position.x=100;backend.render(cam);
  assert.equal(backend.metrics().transparentSubmittedTriangles,4,'legacy bounds update while the paged cut stays unchanged');
  mesh.position.x=100;backend.render(cam);
  assert.equal(backend.metrics().transparentSubmittedTriangles,0);
  mesh.position.x=0;backend.render(cam);
  assert.equal(backend.metrics().transparentSubmittedTriangles,4,'cached pages become visible again');
  legacyMesh.position.x=0;backend.render(cam);
  assert.equal(backend.metrics().transparentSubmittedTriangles,8);
  otherMesh.position.x=0;backend.render(cam);
  assert.equal(backend.metrics().transparentSubmittedTriangles,12);
  assert.equal(writes.slice(uploads).filter(write=>write.bytes.byteLength===24).length,0,'existing index buffers survive visibility changes');
 }finally{await backend.dispose();fixture.geometry.dispose();fixture.material.dispose();other.geometry.dispose();other.material.dispose();legacy.geometry.dispose();legacy.material.dispose();}
});

test('clustered transparency submits only visible pages in one two-sided mesh draw',async()=>{
 installGpuGlobals();const fixture=quadScene(),{device,draws,writes}=mockGpu();
 fixture.material.transparent=true;fixture.material.side=THREE.DoubleSide;
 fixture.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,0,1,0,99,-1,0,101,-1,0,100,1,0],3));
 fixture.geometry.setIndex([0,1,2,3,4,5]);fixture.indices.set('1',new Uint32Array([3,4,5]));
 const primitive=fixture.metadata.primitives[0];primitive.pass='clustered-blend';
 primitive.pages[1].min=[99,-1,0];primitive.pages[1].max=[101,1,0];
 primitive.hierarchy={min:[-1,-1,0],max:[101,1,0],children:primitive.pages.map(p=>({min:p.min,max:p.max,page:p.id}))};
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 try{
  await backend.prepare();backend.render(camera());await backend.flush();draws.length=0;backend.render(camera());
  assert.equal(backend.metrics().transparentSubmittedTriangles,2);
  assert.equal(backend.metrics().transparentDrawCalls,2);
  assert.equal(backend.metrics().transparentMeshes,1);
  assert.equal(backend.metrics().submittedTriangles,2,'transparent pages never enter the opaque pass');
  assert.equal(draws.filter(d=>d.entryPoint==='vs').reduce((n,d)=>n+d.vertexCount,0),6);
  const uploads=writes.length;backend.render(camera());
  assert.equal(writes.slice(uploads).filter(w=>w.bytes.byteLength===12).length,0,'stable cuts do not upload indices again');
 }finally{await backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('clustered transparency does not duplicate forward attributes in opaque GPU buffers',async()=>{
 installGpuGlobals();const allocations:number[]=[];
 for(const pass of ['shared-blend','clustered-blend']){
  const fixture=quadScene(),{device}=mockGpu();fixture.material.transparent=true;fixture.metadata.primitives[0].pass=pass;
  const positions=new Float32Array(3000);positions.set(fixture.geometry.getAttribute('position').array);
  fixture.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
  try{await backend.prepare();backend.render(camera());allocations.push(backend.metrics().geometryAllocationBytes);}
  finally{await backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
 }
 assert.ok(allocations[1]<=allocations[0]+1024,'page indices may add slots; forward vertices must not be copied into opaque position/UV/normal buffers');
});

test('clustered transparency switches LOD with resident coverage and retains both face passes',async()=>{
 installGpuGlobals();const fixture=coarseQuadScene(),{device}=mockGpu();
 fixture.material.transparent=true;fixture.material.side=THREE.DoubleSide;
 fixture.metadata.primitives[0].pass='clustered-blend';
 fixture.metadata.primitives[0].pages[2].count=3;fixture.metadata.primitives[0].pages[2].bytes=12;
 fixture.indices.set('2',new Uint32Array([0,1,2]));
 const backend=webgpuPagesBackend({...fixture,indices:new Map(),readPage:async url=>fixture.indices.get(url)!,gpuDevice:device,maxResidentPages:3,viewport:[32,32]});
 try{
  await backend.prepare();backend.render(camera());
  assert.equal(backend.metrics().transparentSubmittedTriangles,2,'coarse coverage drawn while detail is missing');
  backend.acceptPage!('0',fixture.indices.get('0')!);backend.syncResident!();await backend.flush();backend.render(camera());
  assert.equal(backend.metrics().transparentSubmittedTriangles,2,'partial detail cannot replace coverage');
  backend.acceptPage!('1',fixture.indices.get('1')!);backend.syncResident!();await backend.flush();backend.render(camera());
  assert.equal(backend.metrics().transparentSubmittedTriangles,4);
  assert.equal(backend.metrics().transparentDrawCalls,2,'pages are merged in source order for each face pass');
 }finally{await backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

/** The quad, with its two clusters replaced by a single coarse cluster of screen error 1. */
function coarseQuadScene(){
 const fixture=quadScene();
 const leaves=fixture.metadata.primitives[0].pages;
 const level=dagLevel(leaves,{...leaves[0],id:2,url:'2',count:6,bytes:24},1);
 return {...fixture,metadata:{...fixture.metadata,primitives:[{...fixture.metadata.primitives[0],...level}]},
  indices:new Map([...fixture.indices,['2',new Uint32Array([0,1,2,0,2,3])]] as [string,Uint32Array][])};
}

test('detail replaces the complete GPU fallback only after every replacement is uploaded',async()=>{
 installGpuGlobals();const fixture=coarseQuadScene(),{device}=mockGpu();
 const backend=webgpuPagesBackend({...fixture,indices:new Map(),readPage:async url=>fixture.indices.get(url)!,gpuDevice:device,maxResidentPages:3,viewport:[32,32]});
 try{
  await backend.prepare();backend.render(camera());assert.deepEqual(backend.selectedPageIds(),['2']);
  backend.acceptPage!('0',fixture.indices.get('0')!);backend.syncResident!();await backend.flush();backend.render(camera());
  assert.deepEqual(backend.selectedPageIds(),['2'],'one GPU detail page cannot replace the full fallback');
  backend.dropPage!('2');backend.dropPage!('0');
  backend.acceptPage!('1',fixture.indices.get('1')!);backend.syncResident!();
  assert.deepEqual(backend.selectedPageIds(),['2'],'CPU arrival is not GPU residency');
  await backend.flush();backend.render(camera());assert.deepEqual(backend.selectedPageIds().sort(),['0','1']);
  assert.equal(backend.metrics().submittedTriangles,2);
 }finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('a refinement exceeding the GPU budget retains the complete fallback and reports the limit',async()=>{
 installGpuGlobals();const fixture=coarseQuadScene(),{device}=mockGpu();
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 try{await backend.prepare();for(let i=0;i<4;i++){backend.render(camera());await backend.flush();assert.deepEqual(backend.selectedPageIds(),['2']);assert.equal(backend.metrics().submittedTriangles,2);assert.equal(backend.metrics().coverageBudgetLimited,true);assert.deepEqual(backend.pendingUrls!(),[]);}}
 finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('a failed initial page reader rejects preparation before exposing a partial scene',async()=>{
 installGpuGlobals();const fixture=quadScene(),{device,draws}=mockGpu();
 const backend=webgpuPagesBackend({...fixture,indices:new Map(),readPage:async()=>{throw new Error('PAGE_STREAM_FAILED');},gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 try{await assert.rejects(backend.prepare(),/PAGE_STREAM_FAILED/);assert.equal(draws.length,0);assert.equal(backend.metrics().coverageReady,false);}
 finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('streaming completion during image readback preserves the captured frame and resumes on render',async()=>{
 installGpuGlobals();
 const fixture=coarseQuadScene(),{device,passes,imageCopies}=mockGpu();
 const createBuffer=device.createBuffer.bind(device);
 let mapped!:()=>void,release!:()=>void;
 const mapping=new Promise<void>(resolve=>{mapped=resolve;});
 const gate=new Promise<void>(resolve=>{release=resolve;});
 device.createBuffer=descriptor=>{const buffer=createBuffer(descriptor);if(descriptor.label==='WG explicit capture')buffer.mapAsync=async()=>{mapped();await gate;};return buffer;};
 const backend=webgpuPagesBackend({...fixture,indices:new Map(),readPage:async url=>fixture.indices.get(url)!,gpuDevice:device,maxResidentPages:3,viewport:[32,32]});
 try{
  await backend.prepare();backend.render(camera());
  const flushing=backend.flush();await mapping;
  const before=passes.length;
  assert.deepEqual(backend.pendingUrls?.().sort(),['0','1']);
  for(const [url,array] of fixture.indices)backend.acceptPage?.(url,array);
  backend.syncResident?.();backend.syncResident?.();
  release();await flushing;
  assert.equal(passes.length,before,'streaming must not overwrite an image being captured');
  assert.equal(backend.capture!().length,32*32*4);
  assert.deepEqual(backend.pendingUrls?.(),[],'pages arriving during capture remain accepted');
  assert.equal(imageCopies.length,1,'the capture must not spin on streaming updates');
  backend.render(camera());await backend.flush();backend.render(camera());
  assert.equal(backend.metrics().submittedTriangles,2,'accepted geometry is rendered on subsequent frames');
 }finally{release();backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('surface capture keeps external renders blocked until main-view restoration has finished',async()=>{
 installGpuGlobals();const {device}=mockGpu();const fixture=quadScene();const main=camera();let blocked:unknown;
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32],onDiagnostic(event){if(event.phase==='surface-capture-ready')queueMicrotask(()=>{try{backend.render(main);blocked=false;}catch(error){blocked=String(error);}});}});
 try{await backend.prepare();backend.render(main);await backend.flush?.();const surface=await backend.captureSurfaceView!(camera(),{width:16,height:16});surface.dispose();assert.match(String(blocked),/SURFACE_CAPTURE_BUSY/);}
 finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('a failed transparent material pipeline cannot leave an HDR pass with an rgba8 fallback pipeline',async()=>{
 installGpuGlobals();const {device}=mockGpu();const fixture=quadScene();fixture.material.transparent=true;fixture.material.opacity=.5;fixture.metadata.primitives[0].pass='shared-blend';
 const create=device.createRenderPipeline.bind(device);
 device.createRenderPipeline=descriptor=>{if(descriptor.vertex.entryPoint==='vs'&&descriptor.fragment?.targets[0]?.format==='rgba16float')throw new Error('NO_FORWARD_MATERIAL');return create(descriptor);};
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 try{await backend.prepare();assert.equal(backend.capabilities.unsupported.includes('visibility buffer'),true);backend.render(camera());assert.equal(backend.metrics().submittedTriangles,2);}
 finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('camera jumps and obsolete uploads preserve coverage while detail slots are reclaimed',async()=>{
 installGpuGlobals();const a=coarseQuadScene(),b=coarseQuadScene(),{device}=mockGpu();
 const mesh=b.source.children[0] as THREE.Mesh;mesh.position.x=100;a.source.add(mesh);
 const primitive={...b.metadata.primitives[0],mesh:1,pages:b.metadata.primitives[0].pages.map(page=>({...page,url:'b'+page.url}))};
 const backend=webgpuPagesBackend({...a,metadata:{primitives:[...a.metadata.primitives,primitive]},indices:new Map([...a.indices,...[...b.indices].map(([url,bytes])=>['b'+url,bytes] as const)]),associations:new Map([...a.associations,[mesh,{meshes:1,primitives:0}]]),gpuDevice:device,maxResidentPages:4,viewport:[32,32]});
 const cam=camera(),move=(x:number)=>{cam.position.set(x,0,5);cam.lookAt(x,0,0);cam.updateMatrixWorld();backend.render(cam);assert.equal(backend.metrics().submittedTriangles,2);};
 try{
  await backend.prepare();move(0);await backend.flush();move(0);assert.deepEqual(backend.selectedPageIds().sort(),['0','1']);
  move(100);assert.deepEqual(backend.selectedPageIds(),['b2']);await backend.flush();move(100);assert.deepEqual(backend.selectedPageIds().sort(),['b0','b1']);
  for(let i=0;i<12;i++){move(i%2?100:0);await Promise.resolve();}
  move(0);await backend.flush();move(0);assert.deepEqual(backend.selectedPageIds().sort(),['0','1']);assert.ok(backend.metrics().cacheEvictions!>0);
 }finally{backend.dispose();a.geometry.dispose();a.material.dispose();b.geometry.dispose();b.material.dispose();}
});

test('a visible opaque primitive without a hierarchy still has complete exact-page coverage',async()=>{
 installGpuGlobals();const fixture=quadScene(),{device}=mockGpu();
 const backend=webgpuPagesBackend({...fixture,metadata:{primitives:[{...fixture.metadata.primitives[0],hierarchy:null}]},gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 try{await backend.prepare();backend.render(camera());assert.deepEqual(backend.selectedPageIds().sort(),['0','1']);assert.equal(backend.metrics().submittedTriangles,2);}
 finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('a host eviction deferred for coverage is applied once the page is no longer pinned',async()=>{
 installGpuGlobals();const fixture=coarseQuadScene(),{device}=mockGpu();
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:3,viewport:[32,32]});
 try{
  await backend.prepare();backend.render(camera());await backend.flush();backend.render(camera());backend.dropPage!('0');
  assert.deepEqual(backend.selectedPageIds().sort(),['0','1']);
  const cam=camera();cam.lookAt(0,0,10);backend.render(cam);await backend.flush();backend.render(camera());
  assert.deepEqual(backend.selectedPageIds(),['2']);assert.deepEqual(backend.pendingUrls!(),['0']);
 }finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('a leaf carrying its own coarse representation keeps that GPU fallback during exact-page loading',async()=>{
 installGpuGlobals();const fixture=coarseQuadScene(),{device}=mockGpu();
 // One cluster replaced by one coarser cluster: a group of a single child.
 const leaf={...fixture.metadata.primitives[0].pages[0],count:6,bytes:24};
 const level=dagLevel([leaf],{...fixture.metadata.primitives[0].pages[2],id:1},1);
 const metadata={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups',primitives:[{...fixture.metadata.primitives[0],...level}]};
 const backend=webgpuPagesBackend({...fixture,metadata,indices:new Map(),readPage:async()=>fixture.indices.get('2')!,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 try{await backend.prepare();backend.render(camera());assert.deepEqual(backend.selectedPageIds(),['2']);backend.acceptPage!('0',fixture.indices.get('2')!);backend.render(camera());await backend.flush();backend.render(camera());assert.deepEqual(backend.selectedPageIds(),['0']);}
 finally{backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('cancelling initial coverage loading cannot publish a ready backend',async()=>{
 installGpuGlobals();const fixture=quadScene(),{device,draws}=mockGpu(),controller=new AbortController();let reading!:()=>void,release!:()=>void;
 const started=new Promise<void>(resolve=>{reading=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const backend=webgpuPagesBackend({...fixture,indices:new Map(),readPage:async url=>{reading();await gate;return fixture.indices.get(url)!;},signal:controller.signal,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 try{const preparing=backend.prepare();await started;controller.abort();release();await assert.rejects(preparing,{name:'AbortError'});assert.equal(backend.metrics().coverageReady,false);assert.equal(draws.length,0);}
 finally{release();backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});


test('moving opaque cameras use the current GPU selection without CPU reselection',async()=>{
 installGpuGlobals();const fixture=quadScene();
 const collected=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 const {device,draws}=mockGpu(undefined,packDagSelection(collected.roots));
 const events:Array<{phase:string;context?:Record<string,unknown>}>=[];
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32],onDiagnostic:event=>events.push(event)});
 try{
  await backend.prepare();const cam=camera();
  for(const target of [100,0,100,0]){
   cam.lookAt(target,0,target?5:0);cam.updateMatrixWorld();draws.length=0;
   backend.render(cam);
   assert.equal(draws.filter(draw=>draw.indirect).reduce((sum,draw)=>sum+(draw.instanceCount??0),0),target?0:2);
   await backend.flush();
  }
  assert.equal(events.filter(event=>event.phase==='cpu-selection').length,0,'GPU camera motion must not trigger a duplicate CPU cut');
  assert.ok(events.some(event=>event.phase==='gpu-selection-current-frame'));
 }finally{await backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});


test('a GPU-driven image reaches the queue as one command buffer',async()=>{
 installGpuGlobals();const fixture=quadScene();
 const collected=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 const {device,submits}=mockGpu(undefined,packDagSelection(collected.roots));
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:2,viewport:[32,32]});
 try{
  await backend.prepare();const cam=camera();
  backend.render(cam);await backend.flush();
  for(const target of [100,0,100]){
   cam.lookAt(target,0,target?5:0);cam.updateMatrixWorld();
   submits.length=0;
   backend.render(cam);
   // The selection used to submit its own buffer ahead of the render encoder, which left a host gap
   // inside the image's own GPU span. One image, one buffer.
   assert.equal(submits.length,1,`image looking at ${target}`);
   await backend.flush();
  }
 }finally{await backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});

test('GPU streaming exposes wanted pages after readback and draws an atomic resident fallback',async()=>{
 installGpuGlobals();const fixture=coarseQuadScene();
 fixture.metadata.primitives[0].pages[2].count=3;fixture.metadata.primitives[0].pages[2].bytes=12;
 fixture.indices.set('2',new Uint32Array([0,1,2]));
 const collected=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 const {device,draws}=mockGpu(undefined,packDagSelection(collected.roots));
 const backend=webgpuPagesBackend({...fixture,indices:new Map(),readPage:async url=>fixture.indices.get(url)!,gpuDevice:device,maxResidentPages:3,viewport:[32,32]});
 const render=()=>{draws.length=0;backend.render(camera());};
 try{
  await backend.prepare();render();
  assert.equal(backend.metrics().submittedTriangles,null,'do not report candidate counts as GPU results');
  await backend.flush();
  assert.deepEqual(backend.pendingUrls?.().sort(),['0','1'],'async desired cut is visible to streaming immediately');
  assert.deepEqual(backend.selectedPageIds(),['2']);
  // The published cut is the coarse fallback, and that is what `selectedTriangles` reports: the cut
  // after the fallback, like the WebGL backend. Nothing of it is missing, so there is no hole.
  assert.equal(backend.metrics().selectedTriangles,1);assert.equal(backend.metrics().submittedTriangles,1);
  assert.equal(backend.metrics().uncoveredTriangles,0);
  backend.acceptPage!('0',fixture.indices.get('0')!);render();await backend.flush();render();await backend.flush();
  assert.deepEqual(backend.selectedPageIds(),['2']);
  assert.equal(draws.filter(draw=>draw.indirect).reduce((sum,draw)=>sum+(draw.instanceCount??0),0),1);
  backend.acceptPage!('1',fixture.indices.get('1')!);render();await backend.flush();render();await backend.flush();
  assert.deepEqual(backend.selectedPageIds().sort(),['0','1']);
  assert.equal(backend.metrics().submittedTriangles,2);
  assert.equal(draws.filter(draw=>draw.indirect).reduce((sum,draw)=>sum+(draw.instanceCount??0),0),2,'coarse is absent once all fine pages are drawable');
 }finally{await backend.dispose();fixture.geometry.dispose();fixture.material.dispose();}
});


test('GPU camera jumps reclaim detail slots while preserving pinned coarse coverage',async()=>{
 installGpuGlobals();const a=coarseQuadScene(),b=coarseQuadScene();
 const mesh=b.source.children[0] as THREE.Mesh;mesh.position.x=100;a.source.add(mesh);
 const primitive={...b.metadata.primitives[0],mesh:1,pages:b.metadata.primitives[0].pages.map(page=>({...page,url:'b'+page.url}))};
 const fixture={...a,metadata:{primitives:[...a.metadata.primitives,primitive]},indices:new Map([...a.indices,...[...b.indices].map(([url,bytes])=>['b'+url,bytes] as const)]),associations:new Map([...a.associations,[mesh,{meshes:1,primitives:0}]])};
 const collected=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 const {device,draws}=mockGpu(undefined,packDagSelection(collected.roots));
 const backend=webgpuPagesBackend({...fixture,gpuDevice:device,maxResidentPages:4,viewport:[32,32]});
 const cam=camera();
 try{
  await backend.prepare();
  for(const x of [0,100,0,100]){
   cam.position.set(x,0,5);cam.lookAt(x,0,0);cam.updateMatrixWorld();
   for(let step=0;step<3;step++){
    draws.length=0;backend.render(cam);
    assert.ok(draws.filter(draw=>draw.indirect).some(draw=>!!draw.instanceCount),'current cut must retain visible coverage');
    await backend.flush();assert.equal(backend.metrics().submittedTriangles,2);
   }
   assert.deepEqual(backend.selectedPageIds().sort(),x?['b0','b1']:['0','1']);
  }
  assert.ok(backend.metrics().cacheEvictions!>0);
 }finally{await backend.dispose();a.geometry.dispose();a.material.dispose();b.geometry.dispose();b.material.dispose();}
});

test('a recycled page-table row describes its new cluster and reaches the GPU before the image reads it',async()=>{
 installGpuGlobals();
 const a=coarseQuadScene(),b=coarseQuadScene(),{device,writes,buffers,submits}=mockGpu();
 const mesh=b.source.children[0] as THREE.Mesh;mesh.position.x=100;a.source.add(mesh);
 const primitive={...b.metadata.primitives[0],mesh:1,pages:b.metadata.primitives[0].pages.map(page=>({...page,url:'b'+page.url}))};
 // Six clusters share four rows, so every jump between the two primitives recycles rows on eviction.
 const backend=webgpuPagesBackend({...a,metadata:{primitives:[...a.metadata.primitives,primitive]},
  indices:new Map([...a.indices,...[...b.indices].map(([url,bytes])=>['b'+url,bytes] as const)]),
  associations:new Map([...a.associations,[mesh,{meshes:1,primitives:0}]]),gpuDevice:device,maxResidentPages:4,viewport:[32,32]});
 const view=camera(),words=PAGE_INFO_STRIDE/4;
 const look=(x:number)=>{view.position.set(x,0,5);view.lookAt(x,0,0);view.updateMatrixWorld();backend.render(view);};
 try{
  await backend.prepare();
  for(let round=0;round<6;round++){look(round%2?100:0);await backend.flush();look(round%2?100:0);}
  assert.ok(backend.metrics().cacheEvictions!>0,'the run has to recycle rows');
  const table=buffers.find(buffer=>buffer.label==='WG page table');
  assert.ok(table,'the page table is allocated once');
  const rows=new Uint32Array(table.data.buffer,table.data.byteOffset,table.data.byteLength/4);
  const seen=new Set<number>(),slots=new Set<number>();
  for(let row=0;row<table.size/PAGE_INFO_STRIDE;row++){
   const base=row*words,indexCount=rows[base+25];
   if(!indexCount)continue;
   // A live row names itself, so a recycled row cannot be read through the identifier of its predecessor.
   assert.equal(rows[base+27],(row+1)<<8,`row ${row} identifier`);
   // Its index range is one of the fixture's clusters, and no two live rows claim the same cluster or
   // the same GPU slot: a row still describing the cluster it was recycled from would do both.
   assert.ok(indexCount===3||indexCount===6,`row ${row} index count ${indexCount}`);
   assert.equal(seen.has(rows[base+47]),false,`row ${row} duplicates cluster ${rows[base+47]}`);
   assert.equal(slots.has(rows[base+24]),false,`row ${row} duplicates slot ${rows[base+24]}`);
   seen.add(rows[base+47]);slots.add(rows[base+24]);
  }
  // A leaked row would show up as a live row beyond the four the table holds, and a lost row as fewer
  // live rows than the image drew.
  assert.ok(seen.size<=4&&seen.size>=backend.metrics().residentPages!,`live rows ${seen.size}`);
  const lastRowWrite=writes.filter(write=>write.label==='WG page table').at(-1);
  assert.ok(lastRowWrite,'rows are uploaded');
  assert.ok(lastRowWrite.seq<submits.at(-1)!,'a row is uploaded before the image that reads it is submitted');
 }finally{backend.dispose();a.geometry.dispose();a.material.dispose();b.geometry.dispose();b.material.dispose();}
});
