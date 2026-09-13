import test from 'node:test';import assert from 'node:assert/strict';
import {packDrawIndirect} from '../sdk-core/index.ts';
import {BIN_BACK,BIN_FRONT,BIN_NONE,compactSlotLayout,createGpuDraw,DRAW_INDIRECT_STRIDE,DRAW_SHADER,evaluateDrawCompact,indirectForDraw,PAGE_BIND_ALIGN,type DrawItem} from './gpuDraw.ts';
import {PAGE_INFO_STRIDE} from './visibilityBuffer.ts';

test('compact keeps input order inside each bin and writes 16-byte indirects', () => {
  const items = [
    {pageIndex:4, bin:0 as const, rest:0 as const},
    {pageIndex:1, bin:1 as const, rest:0 as const},
    {pageIndex:7, bin:0 as const, rest:0 as const},
  ];
  const result = evaluateDrawCompact(items, 768, 8);
  assert.equal(result.overflow, false);
  assert.deepEqual([...result.instances.subarray(0,3)], [4,7,1]);
  const back = result.indirect.subarray(0, 4);
  assert.deepEqual([...back], [...packDrawIndirect(768, 2)]);
  const none = result.indirect.subarray(4, 8);
  const expectedNone = packDrawIndirect(768, 1);
  expectedNone[3] = 2;
  assert.deepEqual([...none], [...expectedNone]);
});

test('compact overflow sets the flag and writes zero instance counts', () => {
  const items = [{pageIndex:0, bin:0 as const, rest:0 as const}];
  const result = evaluateDrawCompact(items, 768, 0);
  assert.equal(result.overflow, true);
  assert.equal(result.indirect[1], 0);
});

test('compact rest pass occupies slots 3-5 with exclusive-scan firstInstance',()=>{
 const items:DrawItem[]=[
  {pageIndex:4,bin:BIN_BACK,rest:0},
  {pageIndex:9,bin:BIN_BACK,rest:1},
  {pageIndex:7,bin:BIN_BACK,rest:0},
  {pageIndex:2,bin:BIN_FRONT,rest:1},
 ];
 const result=evaluateDrawCompact(items,768,8);
 assert.equal(result.overflow,false);
 assert.deepEqual([...result.instances],[4,7,9,2]);
 assert.deepEqual([...result.counts],[2,0,0,1,0,1]);
 assert.deepEqual([...result.indirect.subarray(0,4)],[...packDrawIndirect(768,2)]);
 const restBack=result.indirect.subarray(3*4,4*4);
 const expectedRestBack=packDrawIndirect(768,1);expectedRestBack[3]=2;
 assert.deepEqual([...restBack],[...expectedRestBack]);
 const restFront=result.indirect.subarray(5*4,6*4);
 const expectedRestFront=packDrawIndirect(768,1);expectedRestFront[3]=3;
 assert.deepEqual([...restFront],[...expectedRestFront]);
 assert.equal(DRAW_INDIRECT_STRIDE,16);
 assert.equal(BIN_NONE,1);
});

test('overflow zeros instance counts in every indirect slot',()=>{
 const result=evaluateDrawCompact([{pageIndex:0,bin:0,rest:0}],768,0);
 for(let s=0;s<6;s++)assert.equal(result.indirect[s*4+1],0);
 assert.equal(result.instances.length,0);
});

test('draw shader compacts on one thread without atomics',()=>{
 assert.match(DRAW_SHADER,/@compute @workgroup_size\(1\)/);
 assert.match(DRAW_SHADER,/fn compactDraws/);
 assert.doesNotMatch(DRAW_SHADER,/atomicAdd/);
 assert.match(DRAW_SHADER,/rest\s*\*\s*3u\s*\+\s*item\.bin/);
 assert.match(DRAW_SHADER,/indirect\[o\+3u\]=0u/);
});

test('draw consumers zero firstInstance and pad slot binds to 256 bytes',()=>{
 const items:DrawItem[]=[
  {pageIndex:0,bin:BIN_BACK,rest:0},
  {pageIndex:1,bin:BIN_NONE,rest:0},
  {pageIndex:2,bin:BIN_BACK,rest:1},
 ];
 const result=evaluateDrawCompact(items,768,8);
 assert.equal(result.indirect[3],0);
 assert.equal(result.indirect[7],1);
 assert.equal(result.indirect[3*4+3],2);
 const drawn=indirectForDraw(result);
 for(let s=0;s<6;s++)assert.equal(drawn[s*4+3],0);
 assert.equal(drawn[1],1);
 assert.equal(drawn[5],1);
 assert.equal(drawn[3*4+1],1);
 const layout=compactSlotLayout(result.counts,PAGE_INFO_STRIDE);
 assert.equal(PAGE_BIND_ALIGN,256);
 assert.equal(PAGE_INFO_STRIDE,256);
 assert.equal(layout.offsets[0],0);
 assert.equal(layout.offsets[1],256);
 assert.equal(layout.offsets[3],512);
 for(const offset of layout.offsets)assert.equal(offset%PAGE_BIND_ALIGN,0);
 assert.equal(layout.tableRows,3);
});

test('a device without compute pipelines does not create GPU draw',async()=>{
 const device={limits:{maxBufferSize:1<<20},createBuffer(){throw new Error('should not allocate');}} as unknown as GPUDevice;
 assert.equal(await createGpuDraw(device,8),undefined);
 assert.equal(await createGpuDraw({createComputePipeline(){}} as unknown as GPUDevice,0),undefined);
});

test('a compact shader compilation error leaves GPU draw undefined',async()=>{
 installGpuGlobals();
 const {device}=mockDrawDevice({failCompile:true});
 assert.equal(await createGpuDraw(device,8),undefined);
});

test('GPU draw encode peeks the CPU compact and the mock kernel fills indirect+instances',async()=>{
 installGpuGlobals();
 const {device,buffers}=mockDrawDevice();
 const gpu=await createGpuDraw(device,8);
 assert.ok(gpu);
 assert.equal(gpu.indirectBuffer.size,6*DRAW_INDIRECT_STRIDE);
 assert.equal(gpu.indirectBuffer.usage&(GPUBufferUsage.INDIRECT|GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),GPUBufferUsage.INDIRECT|GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC);
 assert.equal(gpu.peek(),null);
 const items:DrawItem[]=[
  {pageIndex:4,bin:BIN_BACK,rest:0},
  {pageIndex:1,bin:BIN_NONE,rest:0},
  {pageIndex:7,bin:BIN_BACK,rest:0},
 ];
 const encoder=device.createCommandEncoder();
 gpu.encode(encoder,items,768);
 const peeked=gpu.peek();
 assert.ok(peeked);
 assert.equal(peeked.overflow,false);
 assert.deepEqual([...peeked.instances],[4,7,1]);
 const expectedNone=packDrawIndirect(768,1);expectedNone[3]=2;
 assert.deepEqual([...peeked.indirect.subarray(4,8)],[...expectedNone]);
 const indirect=buffers.find(buffer=>buffer.usage&GPUBufferUsage.INDIRECT)!;
 const words=new Uint32Array(indirect.data.buffer,indirect.data.byteOffset,indirect.data.byteLength/4);
 assert.deepEqual([...words.subarray(0,4)],[...packDrawIndirect(768,2)]);
 assert.deepEqual([...words.subarray(4,8)],[...packDrawIndirect(768,1)]);
 for(let s=0;s<6;s++)assert.equal(words[s*4+3],0);
 const instances=buffers.find(buffer=>buffer.size===8*4)!;
 const ids=new Uint32Array(instances.data.buffer,instances.data.byteOffset,instances.data.byteLength/4);
 assert.deepEqual([...ids.subarray(0,3)],[4,7,1]);
 gpu.dispose();
 assert.equal(gpu.peek(),null);
});

function installGpuGlobals(){
 Object.assign(globalThis,{
  GPUBufferUsage:{MAP_READ:1,MAP_WRITE:2,COPY_SRC:4,COPY_DST:8,INDEX:16,VERTEX:32,UNIFORM:64,STORAGE:128,INDIRECT:256,QUERY_RESOLVE:512},
  GPUShaderStage:{VERTEX:1,FRAGMENT:2,COMPUTE:4},
  GPUMapMode:{READ:1,WRITE:2},
 });
}

function mockDrawDevice(options:{failCompile?:boolean}={}){
 const buffers:Array<{size:number;usage:number;data:Uint8Array}>=[];
 let bind:{entries:Array<{binding:number;resource:{buffer:(typeof buffers)[number]}}>} | undefined;
 let pipeline:{entryPoint:string}|undefined;
 const device={
  limits:{maxBufferSize:1<<20,maxStorageBufferBindingSize:1<<20},
  createBuffer:({size,usage}:{size:number;usage:number})=>{
   const data=new Uint8Array(size);
   const buffer={size,usage,data,destroy(){}};
   buffers.push(buffer);return buffer;
  },
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:options.failCompile?[{type:'error' as const,message:'fail'}]:[]})}),
  createBindGroupLayout:()=>({}),
  createPipelineLayout:()=>({}),
  createComputePipeline:({compute}:{compute:{entryPoint:string}})=>compute,
  createBindGroup:(desc:typeof bind)=>{bind=desc;return desc;},
  pushErrorScope(){},
  popErrorScope:async()=>null,
  createCommandEncoder:()=>({
   beginComputePass:()=>({
    setPipeline(next:{entryPoint:string}){pipeline=next;},
    setBindGroup(_i:number,group:typeof bind){bind=group;},
    dispatchWorkgroups(){
     if(pipeline?.entryPoint!=='compactDraws'||!bind)return;
     const byBinding=new Map(bind.entries.map(entry=>[entry.binding,entry.resource.buffer]));
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
     new Uint32Array(indBytes.buffer,indBytes.byteOffset,indBytes.byteLength/4).set(indirectForDraw(result));
    },
    end(){},
   }),
   finish:()=>({}),
  }),
  queue:{
   writeBuffer(buffer:{size:number;data:Uint8Array},offset:number,data:BufferSource){
    const bytes=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array((data as ArrayBufferView).buffer,(data as ArrayBufferView).byteOffset,(data as ArrayBufferView).byteLength);
    buffer.data.set(bytes,offset);
   },
   submit(){},
  },
 };
 return {device:device as unknown as GPUDevice,buffers};
}
