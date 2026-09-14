import {exclusiveScan,packDrawIndirect} from '../sdk-core/index.ts';

export const DRAW_INDIRECT_STRIDE=16;
export const PAGE_BIND_ALIGN=256;
export const BIN_BACK=0,BIN_NONE=1,BIN_FRONT=2;
const SLOTS=6,UNIFORM_BYTES=32,WORKGROUP=64;
/** u32 per packed draw item: pageIndex (the page-table row), bin, selectionIndex, padding. */
export const DRAW_ITEM_U32=4;
const ITEM_U32=DRAW_ITEM_U32;

export type DrawItem={pageIndex:number;bin:0|1|2;rest:0|1;selectionIndex?:number};
export type CompactResult={
 instances:Uint32Array;      // compacted pageIndex in input order
 bins:Uint32Array;           // compacted bin
 rests:Uint32Array;          // compacted rest flag
 counts:[number,number,number,number,number,number]; // (bin + 3*rest)
 indirect:Uint32Array;       // 6 * 4 u32, one drawIndirect per (bin, rest)
 overflow:boolean;
};
export type SlotLayout={
 offsets:[number,number,number,number,number,number];
 rows:[number,number,number,number,number,number];
 tableRows:number;
};
export type GpuDraw={
 /**
  * `items` holds `count` packed rows of {pageIndex,bin,selectionIndex,pad} and is uploaded only when
  * `itemsDirty`, because those three are properties of the page-table row and not of the frame.
  * `restBits` is the frame's occluder/rest partition, one bit per item; nothing here allocates.
  */
 encode(encoder:GPUCommandEncoder,items:Uint32Array,count:number,itemsDirty:boolean,restBits:Uint32Array,maxVertexCount:number,selection?:{maskBuffer:GPUBuffer;maskOffset:number}):void;
 indirectBuffer:GPUBuffer;   // 6 * 16 bytes
 instanceBuffer:GPUBuffer;   // slotCap u32 page indices, ordered
 slotOffsetsBuffer:GPUBuffer; // first six group offsets locate each slot in instanceBuffer
 dispose():void;
};

function slotOf(item:DrawItem){return item.rest*3+item.bin;}

function emptyCompact(maxVertexCount:number,overflow:boolean):CompactResult{
 const counts:[number,number,number,number,number,number]=[0,0,0,0,0,0];
 const indirect=new Uint32Array(SLOTS*4);
 for(let s=0;s<SLOTS;s++)indirect.set(packDrawIndirect(maxVertexCount,0),s*4);
 return {instances:new Uint32Array(0),bins:new Uint32Array(0),rests:new Uint32Array(0),counts,indirect,overflow};
}

/** Stable exclusive-scan compact into six (bin + 3*rest) drawIndirect slots. Overflow zeros instance counts. */
export function evaluateDrawCompact(items:DrawItem[],maxVertexCount:number,slotCap:number):CompactResult{
 if(items.length>slotCap)return emptyCompact(maxVertexCount,true);
 const n=items.length;
 const counts:[number,number,number,number,number,number]=[0,0,0,0,0,0];
 for(let i=0;i<n;i++)counts[slotOf(items[i])]++;
 const [starts]=exclusiveScan(counts);
 const indirect=new Uint32Array(SLOTS*4);
 for(let s=0;s<SLOTS;s++){
  const words=packDrawIndirect(maxVertexCount,counts[s]);
  words[3]=starts[s];
  indirect.set(words,s*4);
 }
 const instances=new Uint32Array(n);
 const bins=new Uint32Array(n);
 const rests=new Uint32Array(n);
 const writePos=[starts[0],starts[1],starts[2],starts[3],starts[4],starts[5]];
 for(let i=0;i<n;i++){
  const item=items[i];
  const slot=slotOf(item);
  const dst=writePos[slot]++;
  instances[dst]=item.pageIndex;
  bins[dst]=item.bin;
  rests[dst]=item.rest;
 }
 return {
  instances,bins,rests,
  counts,indirect,overflow:false,
 };
}

/** Pad each compact region so a storage bind offset is a multiple of `align` (WebGPU minStorageBufferOffsetAlignment). */
export function compactSlotLayout(counts:ArrayLike<number>,stride:number,align=PAGE_BIND_ALIGN):SlotLayout{
 const offsets:[number,number,number,number,number,number]=[0,0,0,0,0,0];
 const rows:[number,number,number,number,number,number]=[0,0,0,0,0,0];
 let bytes=0,used=0;
 for(let s=0;s<SLOTS;s++){
  if(bytes%align)bytes+=align-(bytes%align);
  offsets[s]=bytes;
  rows[s]=stride?bytes/stride:0;
  bytes+=counts[s]*stride;
  if(counts[s])used=bytes;
 }
 return {offsets,rows,tableRows:Math.max(1,stride?used/stride:1)};
}

/** DrawIndirect words with firstInstance=0. Compact still records exclusive-scan starts in word[3]. */
export function indirectForDraw(compact:CompactResult):Uint32Array{
 const words=compact.indirect.slice();
 for(let s=0;s<SLOTS;s++)words[s*4+3]=0;
 return words;
}

export const DRAW_SHADER=`struct DrawItem{pageIndex:u32,bin:u32,selectionIndex:u32,pad0:u32,}
struct Uniforms{count:u32,maxVertexCount:u32,slotCap:u32,groupCount:u32,selectionEnabled:u32,selectionOffset:u32,pad0:u32,pad1:u32,}
@group(0) @binding(0) var<storage, read> items:array<DrawItem>;
@group(0) @binding(1) var<uniform> uni:Uniforms;
@group(0) @binding(2) var<storage, read_write> instances:array<u32>;
@group(0) @binding(3) var<storage, read_write> indirect:array<u32>;
@group(0) @binding(4) var<storage, read_write> groupCounts:array<u32>;
@group(0) @binding(5) var<storage, read_write> groupOffsets:array<u32>;
@group(0) @binding(6) var<storage, read> selectionMask:array<u32>;
@group(0) @binding(7) var<storage, read> restBits:array<u32>;
// The occluder/rest partition is the only per-frame word of an item, so it travels as one bit each.
fn restAt(i:u32)->u32{return (restBits[i>>5u]>>(i&31u))&1u;}
fn selected(item:DrawItem)->bool{
 if(uni.selectionEnabled==0u){return true;}
 return selectionMask[uni.selectionOffset+item.selectionIndex]!=0u;
}
fn matches(i:u32,slot:u32)->bool{let item=items[i];return restAt(i)*3u+item.bin==slot&&selected(item);}
fn writeCmd(slot:u32,count:u32){
 let o=slot*4u;
 indirect[o]=uni.maxVertexCount;
 indirect[o+1u]=count;
 indirect[o+2u]=0u;
 indirect[o+3u]=0u;
}
@compute @workgroup_size(64)
fn countGroups(@builtin(global_invocation_id) id:vec3u){
 let entry=id.x;
 if(entry>=uni.groupCount*6u){return;}
 let group=entry/6u;let slot=entry%6u;
 var count=0u;
 let begin=group*64u;let end=min(begin+64u,min(uni.count,uni.slotCap));
 for(var i=begin;i<end;i++){if(matches(i,slot)){count=count+1u;}}
 groupCounts[entry]=count;
}
@compute @workgroup_size(1)
fn prefixGroups(){
 if(uni.count>uni.slotCap){
  writeCmd(0u,0u);writeCmd(1u,0u);writeCmd(2u,0u);
  writeCmd(3u,0u);writeCmd(4u,0u);writeCmd(5u,0u);
  return;
 }
 var slotStart=0u;
 for(var slot=0u;slot<6u;slot++){
  var total=0u;
  for(var group=0u;group<uni.groupCount;group++){total=total+groupCounts[group*6u+slot];}
  var cursor=slotStart;
  for(var group=0u;group<uni.groupCount;group++){
   let entry=group*6u+slot;
   groupOffsets[entry]=cursor;
   cursor=cursor+groupCounts[entry];
  }
  writeCmd(slot,total);
  slotStart=slotStart+total;
 }
}
@compute @workgroup_size(64)
fn scatterGroups(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 if(i>=uni.count||uni.count>uni.slotCap){return;}
 let item=items[i];if(!selected(item)){return;}let slot=restAt(i)*3u+item.bin;
 let group=i/64u;let begin=group*64u;
 var rank=0u;
 for(var j=begin;j<i;j++){if(matches(j,slot)){rank=rank+1u;}}
 instances[groupOffsets[group*6u+slot]+rank]=item.pageIndex;
}
`;

/** Stable GPU compact into six drawIndirect commands. Missing compute returns undefined so the caller keeps the CPU draw loop. */
export async function createGpuDraw(device:GPUDevice,slotCap:number):Promise<GpuDraw|undefined>{
 if(typeof device.createComputePipeline!=='function'||slotCap<1)return undefined;
 const itemBytes=slotCap*ITEM_U32*4,restBytes=Math.max(4,Math.ceil(slotCap/32)*4),instanceBytes=slotCap*4,indirectBytes=SLOTS*DRAW_INDIRECT_STRIDE,groupCount=Math.ceil(slotCap/WORKGROUP),groupBytes=groupCount*SLOTS*4;
 const buffers:GPUBuffer[]=[];
 let disposed=false;
 try{
  const itemsBuf=device.createBuffer({size:itemBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const restBuf=device.createBuffer({size:restBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const uniforms=device.createBuffer({size:UNIFORM_BYTES,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const instanceBuffer=device.createBuffer({size:instanceBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
  const indirectBuffer=device.createBuffer({size:indirectBytes,usage:GPUBufferUsage.INDIRECT|GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
  const groupCounts=device.createBuffer({size:groupBytes,usage:GPUBufferUsage.STORAGE});
  const groupOffsets=device.createBuffer({size:groupBytes,usage:GPUBufferUsage.STORAGE});
  buffers.push(itemsBuf,restBuf,uniforms,instanceBuffer,indirectBuffer,groupCounts,groupOffsets);
  if(typeof device.pushErrorScope==='function')device.pushErrorScope('validation');
  const layout=device.createBindGroupLayout({entries:[
   {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
   {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
   {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
   {binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
   {binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
   {binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
   {binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
   {binding:7,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
  ]});
  const module=device.createShaderModule({code:DRAW_SHADER});
  if(typeof module.getCompilationInfo==='function'){
   const info=await module.getCompilationInfo();
   if(info.messages.some(message=>message.type==='error')){
    if(typeof device.popErrorScope==='function')await device.popErrorScope().catch(()=>{});
    for(const buffer of buffers)buffer.destroy();
    return undefined;
   }
  }
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const countPipeline=device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint:'countGroups'}});
  const prefixPipeline=device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint:'prefixGroups'}});
  const scatterPipeline=device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint:'scatterGroups'}});
  if(typeof device.popErrorScope==='function'){
   const error=await device.popErrorScope();
   if(error){for(const buffer of buffers)buffer.destroy();return undefined;}
  }
  const makeBindGroup=(maskBuffer:GPUBuffer)=>device.createBindGroup({layout,entries:[
   {binding:0,resource:{buffer:itemsBuf}},
   {binding:1,resource:{buffer:uniforms}},
   {binding:2,resource:{buffer:instanceBuffer}},
   {binding:3,resource:{buffer:indirectBuffer}},
   {binding:4,resource:{buffer:groupCounts}},
   {binding:5,resource:{buffer:groupOffsets}},
   {binding:6,resource:{buffer:maskBuffer}},
   {binding:7,resource:{buffer:restBuf}},
  ]});
  let boundMask=itemsBuf,bindGroup=makeBindGroup(boundMask);
  const uniData=new Uint32Array(UNIFORM_BYTES/4);
  return {
   encode(encoder,items,count,itemsDirty,restBits,maxVertexCount,selection){
    if(disposed)return;
    const n=Math.min(count,slotCap);
    if(n&&itemsDirty)device.queue.writeBuffer(itemsBuf,0,items.buffer as ArrayBuffer,items.byteOffset,n*ITEM_U32*4);
    if(n)device.queue.writeBuffer(restBuf,0,restBits.buffer as ArrayBuffer,restBits.byteOffset,Math.ceil(n/32)*4);
    // Only the groups the frame's items reach are counted and prefixed. The groups past them hold zero
    // by construction and nothing reads them, so bounding the serial prefix by the live count is exact.
    const liveGroups=Math.max(1,Math.ceil(n/WORKGROUP));
    uniData[0]=count;uniData[1]=maxVertexCount;uniData[2]=slotCap;uniData[3]=liveGroups;
    uniData[4]=selection?1:0;uniData[5]=selection?.maskOffset??0;
    const mask=selection?.maskBuffer??itemsBuf;
    if(mask!==boundMask){boundMask=mask;bindGroup=makeBindGroup(mask);}
    device.queue.writeBuffer(uniforms,0,uniData);
    const pass=encoder.beginComputePass({label:'WG draw compaction'});
    pass.setBindGroup(0,bindGroup);
    pass.setPipeline(countPipeline);pass.dispatchWorkgroups(Math.ceil(liveGroups*SLOTS/WORKGROUP));
    pass.setPipeline(prefixPipeline);pass.dispatchWorkgroups(1);
    pass.setPipeline(scatterPipeline);pass.dispatchWorkgroups(liveGroups);
    pass.end();
   },
   indirectBuffer,
   instanceBuffer,
   slotOffsetsBuffer:groupOffsets,
   dispose(){disposed=true;for(const buffer of buffers)buffer.destroy();},
  };
 }catch{
  if(typeof device.popErrorScope==='function')await device.popErrorScope().catch(()=>{});
  for(const buffer of buffers)try{buffer.destroy();}catch{/* Partial GPU draw setup must not leak. */}
  return undefined;
 }
}
