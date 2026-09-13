import {compact,exclusiveScan,packDrawIndirect} from '../sdk-core/index.ts';

export const DRAW_INDIRECT_STRIDE=16;
export const PAGE_BIND_ALIGN=256;
export const BIN_BACK=0,BIN_NONE=1,BIN_FRONT=2;
const SLOTS=6,ITEM_U32=3,UNIFORM_BYTES=16;

export type DrawItem={pageIndex:number;bin:0|1|2;rest:0|1};
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
 encode(encoder:GPUCommandEncoder,items:DrawItem[],maxVertexCount:number):void;
 indirectBuffer:GPUBuffer;   // 6 * 16 bytes
 instanceBuffer:GPUBuffer;   // slotCap u32 page indices, ordered
 peek():CompactResult|null;
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

export const DRAW_SHADER=`struct DrawItem{pageIndex:u32,bin:u32,rest:u32,}
struct Uniforms{count:u32,maxVertexCount:u32,slotCap:u32,pad:u32,}
@group(0) @binding(0) var<storage, read> items:array<DrawItem>;
@group(0) @binding(1) var<uniform> uni:Uniforms;
@group(0) @binding(2) var<storage, read_write> instances:array<u32>;
@group(0) @binding(3) var<storage, read_write> indirect:array<u32>;
fn matches(item:DrawItem,slot:u32)->bool{return item.rest*3u+item.bin==slot;}
fn countSlot(slot:u32)->u32{
 var n=0u;
 for(var i=0u;i<uni.count;i++){if(matches(items[i],slot)){n=n+1u;}}
 return n;
}
fn scatter(slot:u32,start:u32){
 var dst=start;
 for(var i=0u;i<uni.count;i++){
  let item=items[i];
  if(matches(item,slot)){instances[dst]=item.pageIndex;dst=dst+1u;}
 }
}
fn writeCmd(slot:u32,count:u32){
 let o=slot*4u;
 indirect[o]=uni.maxVertexCount;
 indirect[o+1u]=count;
 indirect[o+2u]=0u;
 indirect[o+3u]=0u;
}
@compute @workgroup_size(1)
fn compactDraws(){
 if(uni.count>uni.slotCap){
  writeCmd(0u,0u);writeCmd(1u,0u);writeCmd(2u,0u);
  writeCmd(3u,0u);writeCmd(4u,0u);writeCmd(5u,0u);
  return;
 }
 let c0=countSlot(0u);let c1=countSlot(1u);let c2=countSlot(2u);
 let c3=countSlot(3u);let c4=countSlot(4u);let c5=countSlot(5u);
 let s0=0u;let s1=s0+c0;let s2=s1+c1;let s3=s2+c2;let s4=s3+c3;let s5=s4+c4;
 writeCmd(0u,c0);writeCmd(1u,c1);writeCmd(2u,c2);
 writeCmd(3u,c3);writeCmd(4u,c4);writeCmd(5u,c5);
 scatter(0u,s0);scatter(1u,s1);scatter(2u,s2);
 scatter(3u,s3);scatter(4u,s4);scatter(5u,s5);
}
`;

/** Stable GPU compact into six drawIndirect commands. Missing compute returns undefined so the caller keeps the CPU draw loop. */
export async function createGpuDraw(device:GPUDevice,slotCap:number):Promise<GpuDraw|undefined>{
 if(typeof device.createComputePipeline!=='function'||slotCap<1)return undefined;
 const itemBytes=slotCap*ITEM_U32*4,instanceBytes=slotCap*4,indirectBytes=SLOTS*DRAW_INDIRECT_STRIDE;
 const buffers:GPUBuffer[]=[];
 let last:CompactResult|null=null,disposed=false;
 try{
  const itemsBuf=device.createBuffer({size:itemBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const uniforms=device.createBuffer({size:UNIFORM_BYTES,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const instanceBuffer=device.createBuffer({size:instanceBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
  const indirectBuffer=device.createBuffer({size:indirectBytes,usage:GPUBufferUsage.INDIRECT|GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
  buffers.push(itemsBuf,uniforms,instanceBuffer,indirectBuffer);
  if(typeof device.pushErrorScope==='function')device.pushErrorScope('validation');
  const layout=device.createBindGroupLayout({entries:[
   {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
   {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
   {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
   {binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
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
  const pipeline=device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint:'compactDraws'}});
  if(typeof device.popErrorScope==='function'){
   const error=await device.popErrorScope();
   if(error){for(const buffer of buffers)buffer.destroy();return undefined;}
  }
  const bindGroup=device.createBindGroup({layout,entries:[
   {binding:0,resource:{buffer:itemsBuf}},
   {binding:1,resource:{buffer:uniforms}},
   {binding:2,resource:{buffer:instanceBuffer}},
   {binding:3,resource:{buffer:indirectBuffer}},
  ]});
  const uniData=new Uint32Array(UNIFORM_BYTES/4);
  return {
   encode(encoder,items,maxVertexCount){
    if(disposed)return;
    last=evaluateDrawCompact(items,maxVertexCount,slotCap);
    const n=Math.min(items.length,slotCap);
    if(n){
     const packed=new Uint32Array(n*ITEM_U32);
     for(let i=0;i<n;i++){packed[i*ITEM_U32]=items[i].pageIndex;packed[i*ITEM_U32+1]=items[i].bin;packed[i*ITEM_U32+2]=items[i].rest;}
     device.queue.writeBuffer(itemsBuf,0,packed);
    }
    uniData[0]=items.length;uniData[1]=maxVertexCount;uniData[2]=slotCap;uniData[3]=0;
    device.queue.writeBuffer(uniforms,0,uniData);
    const pass=encoder.beginComputePass({label:'WG draw compaction'});
    pass.setPipeline(pipeline);pass.setBindGroup(0,bindGroup);pass.dispatchWorkgroups(1);
    pass.end();
   },
   indirectBuffer,
   instanceBuffer,
   peek(){return last;},
   dispose(){disposed=true;last=null;for(const buffer of buffers)buffer.destroy();},
  };
 }catch{
  if(typeof device.popErrorScope==='function')await device.popErrorScope().catch(()=>{});
  for(const buffer of buffers)try{buffer.destroy();}catch{/* Partial GPU draw setup must not leak. */}
  return undefined;
 }
}
