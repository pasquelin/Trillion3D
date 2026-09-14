import {hizBuildPyramid,hizReduceCeil} from '../sdk-core/index.ts';
import {HIZ_BOUNDS_VALUES,HIZ_TEST_VALUES,createHizCounts,hizOversizedFlat,hizRejects,hizTestRectFlat,type HizBounds,type HizCounts,type HizPyramid} from './hiz.ts';

const WORKGROUP=8,TEST_WORKGROUP=64,UNIFORM_BYTES=256,MAX_LEVELS=16;
/**
 * Images between two readbacks of the test verdicts. The verdicts are written by the GPU, so counting
 * what they eliminated costs one copy of the flag rows and one mapping; both are kept off the images
 * in between, and neither ever blocks an image.
 */
const COUNT_EVERY_IMAGES=15;

export type PackedHiz={data:Float32Array;sizes:Array<[number,number]>;offsets:number[]};

export function hizLevelSizes(width:number,height:number):Array<[number,number]>{
 if(width<1||height<1)throw new Error('HIZ_DEPTH_SIZE');
 const sizes:Array<[number,number]>=[[width,height]];
 while(sizes[sizes.length-1][0]>1||sizes[sizes.length-1][1]>1){
  const [w,h]=sizes[sizes.length-1];
  sizes.push([Math.ceil(w/2),Math.ceil(h/2)]);
 }
 return sizes;
}

function rowsOf(data:Float32Array,width:number,height:number,offset=0){
 const rows:number[][]=[];
 for(let y=0;y<height;y++){
  const row=new Array<number>(width);
  for(let x=0;x<width;x++)row[x]=data[offset+y*width+x];
  rows.push(row);
 }
 return rows;
}

/** Pack level-0 rows into the full ceil-max pyramid used by the GPU kernel. */
export function packHizPyramid(level0:readonly(readonly number[])[]):PackedHiz{
 const levels=hizBuildPyramid(level0);
 const sizes=levels.map(level=>[level[0].length,level.length] as [number,number]);
 const offsets:number[]=[];
 let total=0;
 for(const [w,h] of sizes){offsets.push(total);total+=w*h;}
 const data=new Float32Array(Math.max(1,total));
 for(let i=0;i<levels.length;i++){
  const level=levels[i],[w]=sizes[i],base=offsets[i];
  for(let y=0;y<level.length;y++)data.set(level[y],base+y*w);
 }
 return {data,sizes,offsets};
}

/** One ceil-2×2 max reduction of a packed level (background 1). */
export function evaluateHizReduce(src:Float32Array,srcWidth:number,srcHeight:number){
 const reduced=hizReduceCeil(rowsOf(src,srcWidth,srcHeight));
 const height=reduced.length,width=height?reduced[0].length:0;
 const data=new Float32Array(Math.max(1,width*height));
 for(let y=0;y<height;y++)data.set(reduced[y],y*width);
 return {data,width,height};
}

function pyramidFromPacked(packed:PackedHiz):HizPyramid{
 const levels=packed.sizes.map(([w,h],i)=>rowsOf(packed.data,w,h,packed.offsets[i]));
 return {levels,width:packed.sizes[0][0],height:packed.sizes[0][1]};
}

/** Same rejection as `hizRejects` (mip-selected inclusive footprint, near clips never hide). */
export function evaluateHizTest(packed:PackedHiz,bounds:HizBounds[],bias=0){
 const pyramid=pyramidFromPacked(packed);
 const flags=new Uint32Array(bounds.length);
 for(let i=0;i<bounds.length;i++)flags[i]=hizRejects(pyramid,bounds[i],bias)?1:0;
 return flags;
}

export const HIZ_SHADER=`struct Uni{a:u32,b:u32,c:u32,d:u32,e:u32,f:u32,g:u32,h:u32,}
struct Bounds{minX:i32,minY:i32,maxX:i32,maxY:i32,nearest:f32,rowAndClip:u32,pad0:u32,pad1:u32,}
@group(0) @binding(0) var<storage, read_write> pyramid:array<f32>;
@group(0) @binding(1) var level0:texture_2d<f32>;
@group(0) @binding(2) var<uniform> uni:Uni;
@group(0) @binding(3) var<storage, read> bounds:array<Bounds>;
@group(0) @binding(4) var<storage, read_write> flags:array<u32>;
@compute @workgroup_size(8, 8)
fn copyDepth(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=uni.a||id.y>=uni.b){return;}
 let z=textureLoad(level0,vec2i(i32(id.x),i32(id.y)),0).r;
 pyramid[uni.c+id.y*uni.a+id.x]=z;
}
@compute @workgroup_size(8, 8)
fn reduceHiz(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=uni.e||id.y>=uni.f){return;}
 let x0=id.x*2u;let y0=id.y*2u;
 var far=pyramid[uni.a+y0*uni.b+x0];
 if(x0+1u<uni.b){far=max(far,pyramid[uni.a+y0*uni.b+x0+1u]);}
 if(y0+1u<uni.c){
  far=max(far,pyramid[uni.a+(y0+1u)*uni.b+x0]);
  if(x0+1u<uni.b){far=max(far,pyramid[uni.a+(y0+1u)*uni.b+x0+1u]);}
 }
 pyramid[uni.d+id.y*uni.e+id.x]=far;
}
fn footprintFar(b:Bounds)->f32{
 let x0=b.minX;let y0=b.minY;let x1=b.maxX+1;let y1=b.maxY+1;
 if(x1<=x0||y1<=y0){return 1.0;}
 if(x1-x0>16||y1-y0>16){return 1.0;}
 var far=-1.0e30;var hit=false;
 for(var y=y0;y<y1;y++){
  for(var x=x0;x<x1;x++){
   far=max(far,pyramid[b.pad0+u32(y)*b.pad1+u32(x)]);
   hit=true;
  }
 }
 if(!hit){return 1.0;}
 return far;
}
// Only the boxes tested this frame travel to the GPU, so each carries the flag row it answers for;
// the rows the frame does not test were cleared to zero before this pass.
@compute @workgroup_size(64)
fn testHiz(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.c){return;}
 let b=bounds[i];
 let row=b.rowAndClip>>1u;
 if((b.rowAndClip&1u)!=0u||b.maxX<b.minX||b.maxY<b.minY){flags[row]=0u;return;}
 let far=footprintFar(b);
 let bias=bitcast<f32>(uni.d);
 flags[row]=select(0u,1u,b.nearest>far+bias);
}
`;

/**
 * Per-image inputs the counters need and the test does not: the triangles each tested box carries, in
 * the order the boxes are handed over, and the image those boxes belong to. One object, reused by the
 * caller from image to image, so counting allocates nothing per image.
 */
export type HizCountSample={triangles:ArrayLike<number>;frame:number};

export type GpuHiz={
 width:number;
 height:number;
 level0:GPUTexture;
 level0View:GPUTextureView;
 flags:GPUBuffer;
 encodePyramid(encoder:GPUCommandEncoder):void;
 /**
  * Tests `count` boxes from the flat layout `projectBoxesFlat` writes; `rows[i]` names the `flags`
  * entry box `i` answers for. `flagRows` entries are cleared first, so a row this frame does not test
  * reads 0 instead of the verdict of an earlier frame.
  */
 encodeTest(device:GPUDevice,encoder:GPUCommandEncoder,bounds:Float64Array,rows:Uint32Array,count:number,flagRows:number,sample?:HizCountSample):number;
 /**
  * Hands the verdicts of the sampled image to the mapping. Called once the image that `encodeTest`
  * encoded the copy into has been submitted: a mapping requested before the submission would make
  * that submission use a mapped buffer. A no-op on every image that encoded no copy.
  */
 countsSubmitted():void;
 /**
  * Counts of the last image whose verdicts came back, and the number of that image. Undefined until
  * one has: nothing here is deduced, and a device that cannot map a buffer never reports counts.
  */
 counts():(HizCounts&{frame:number})|undefined;
 resize(device:GPUDevice,width:number,height:number):boolean;
 dispose():void;
};

function pyramidBytes(width:number,height:number){
 const sizes=hizLevelSizes(width,height);
 let texels=0;
 for(const [w,h] of sizes)texels+=w*h;
 return {sizes,bytes:Math.max(4,texels*4)};
}

function writeUni(device:GPUDevice,buffer:GPUBuffer,packed:Float32Array,ints:number[],byteOffset=0){
 packed.fill(0);
 const u32=new Uint32Array(packed.buffer,packed.byteOffset,packed.length);
 for(let i=0;i<ints.length;i++)u32[i]=ints[i];
 device.queue.writeBuffer(buffer,byteOffset,packed.buffer as ArrayBuffer,packed.byteOffset,packed.byteLength);
}

/** This-frame Hi-Z from the visbuffer r32float depth (background 1, max reduction). Missing compute returns undefined. */
export async function createGpuHiz(device:GPUDevice,width:number,height:number,maxBounds:number):Promise<GpuHiz|undefined>{
 if(typeof device.createComputePipeline!=='function'||width<1||height<1)return undefined;
 const cap=Math.max(1,maxBounds);
 const uniData=new Float32Array(UNIFORM_BYTES/4);
 // Reused across frames: the test path must not allocate a byte per image.
 let testBytes=new ArrayBuffer(32),testF32=new Float32Array(testBytes),testI32=new Int32Array(testBytes),testU32=new Uint32Array(testBytes);
 // The level and clipped rectangle of the box being written, reused by every box of every image.
 const testRect=new Int32Array(HIZ_TEST_VALUES);
 // Counter state, all of it sized once. `counted` describes the last image whose verdicts came back;
 // `sampled*` hold the image being read, because the caller's own arrays are rewritten by the next one.
 const counted=createHizCounts() as HizCounts&{frame:number};counted.frame=-1;
 let countedReady=false;
 const sampledRows=new Uint32Array(cap),sampledTriangles=new Uint32Array(cap);
 let sampledCount=0,sampledFrame=-1,sampledTested=0,sampledOversized=0,sampledTestedTriangles=0,sampledOversizedTriangles=0;
 let readback:GPUBuffer|undefined,readbackRows=0,copyEncoded=false,mapping=false,lastCountedFrame=-COUNT_EVERY_IMAGES;
 const buffers:GPUBuffer[]=[];
  let disposed=false,level0:GPUTexture|undefined,level0View:GPUTextureView|undefined,pyramid:GPUBuffer|undefined,bindGroup:GPUBindGroup|undefined;
  let sizes:Array<[number,number]>=[],offsets:number[]=[];
  try{
   if(typeof device.pushErrorScope==='function')device.pushErrorScope('validation');
   const layout=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
    {binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float'}},
    {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform',hasDynamicOffset:true,minBindingSize:UNIFORM_BYTES}},
    {binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
    {binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
   ]});
   const module=device.createShaderModule({code:HIZ_SHADER});
   if(typeof module.getCompilationInfo==='function'){
    const info=await module.getCompilationInfo();
    if(info.messages.some(message=>message.type==='error')){
     if(typeof device.popErrorScope==='function')await device.popErrorScope().catch(()=>{});
     return undefined;
    }
   }
   const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
   const copyPipeline=device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint:'copyDepth'}});
   const reducePipeline=device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint:'reduceHiz'}});
   const testPipeline=device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint:'testHiz'}});
   if(typeof device.popErrorScope==='function'){
    const error=await device.popErrorScope();
    if(error)return undefined;
   }
   const uniformSlots=MAX_LEVELS+2;
   const uniforms=device.createBuffer({size:UNIFORM_BYTES*uniformSlots,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
   const bounds=device.createBuffer({size:Math.max(32,cap*32),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
   const flags=device.createBuffer({size:Math.max(4,cap*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
   buffers.push(uniforms,bounds,flags);
   const bind=(nextPyramid:GPUBuffer,nextView:GPUTextureView)=>{
    bindGroup=device.createBindGroup({layout,entries:[
     {binding:0,resource:{buffer:nextPyramid}},
     {binding:1,resource:nextView},
     {binding:2,resource:{buffer:uniforms,size:UNIFORM_BYTES}},
     {binding:3,resource:{buffer:bounds}},
     {binding:4,resource:{buffer:flags}},
    ]});
   };
   // Every level's source and destination are a function of the target size alone, so the whole
   // uniform array is written once per allocation and no image uploads a byte to build the pyramid.
   const levelWords=new Uint32Array((MAX_LEVELS+1)*(UNIFORM_BYTES/4));
   const alloc=(w:number,h:number)=>{
    const packed=pyramidBytes(w,h);
    sizes=packed.sizes;
    offsets=[];let texels=0;for(const [levelWidth,levelHeight] of sizes){offsets.push(texels);texels+=levelWidth*levelHeight;}
    level0?.destroy();pyramid?.destroy();
    level0=device.createTexture({size:{width:w,height:h},format:'r32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    level0View=level0.createView();
    pyramid=device.createBuffer({size:packed.bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    bind(pyramid,level0View);
    levelWords.fill(0);
    levelWords[0]=w;levelWords[1]=h;levelWords[2]=0;
    for(let i=0;i<sizes.length-1&&i+1<MAX_LEVELS;i++){
     const [srcW,srcH]=sizes[i],[dstW,dstH]=sizes[i+1],base=(i+1)*(UNIFORM_BYTES/4);
     levelWords[base]=offsets[i];levelWords[base+1]=srcW;levelWords[base+2]=srcH;
     levelWords[base+3]=offsets[i+1];levelWords[base+4]=dstW;levelWords[base+5]=dstH;
    }
    device.queue.writeBuffer(uniforms,0,levelWords);
    return true;
   };
   if(!alloc(width,height)||!level0||!level0View||!pyramid||!bindGroup){
    for(const buffer of buffers)buffer.destroy();
    level0?.destroy();pyramid?.destroy();
    return undefined;
   }
   /** `GPUMapMode.READ`, or the value it holds where a stub device leaves the enum undefined. */
   const mapRead=()=>(globalThis as {GPUMapMode?:{READ:number}}).GPUMapMode?.READ??1;
   /** Staging buffer for the verdicts, made on the first sampled image and never once per image. */
   const ensureReadback=(target:GPUDevice)=>{
    if(readback)return true;
    if(typeof target.createBuffer!=='function')return false;
    try{
     const buffer=target.createBuffer({label:'WG HiZ counts readback',size:Math.max(4,cap*4),usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
     if(typeof buffer.mapAsync!=='function'||typeof buffer.getMappedRange!=='function'){buffer.destroy();return false;}
     readback=buffer;return true;
    }catch{return false;}
   };
   const gpu:GpuHiz={
    width,height,level0,level0View,flags,
    // One compute pass builds the whole pyramid: consecutive dispatches inside a pass already see each
    // other's writes, so a pass per mip bought nothing but its own submission cost.
    encodePyramid(encoder){
     if(disposed||!bindGroup||!pyramid)return;
     const pass=encoder.beginComputePass({label:'WG HiZ pyramid'});
     pass.setPipeline(copyPipeline);pass.setBindGroup(0,bindGroup,[0]);
     pass.dispatchWorkgroups(Math.max(1,Math.ceil(gpu.width/WORKGROUP)),Math.max(1,Math.ceil(gpu.height/WORKGROUP)));
     pass.setPipeline(reducePipeline);
     for(let i=0;i<sizes.length-1&&i+1<MAX_LEVELS;i++){
      const [dstW,dstH]=sizes[i+1];
      pass.setBindGroup(0,bindGroup,[(i+1)*UNIFORM_BYTES]);
      pass.dispatchWorkgroups(Math.max(1,Math.ceil(dstW/WORKGROUP)),Math.max(1,Math.ceil(dstH/WORKGROUP)));
     }
     pass.end();
    },
    encodeTest(queueDevice,encoder,next,rows,boundsCount,flagRows,sample){
     if(disposed||!bindGroup)return 0;
     const count=Math.min(boundsCount,cap);
     if(flagRows>0)encoder.clearBuffer(flags,0,Math.min(cap,flagRows)*4);
     const need=Math.max(32,count*32);
     if(testBytes.byteLength<need){testBytes=new ArrayBuffer(need);testF32=new Float32Array(testBytes);testI32=new Int32Array(testBytes);testU32=new Uint32Array(testBytes);}
     // A sample is due when no mapping is in flight and the interval has elapsed; the rows and their
     // triangles are copied out here because the caller rewrites its own arrays on the next image.
     const due=!!sample&&!mapping&&!copyEncoded&&flagRows>0&&sample.frame-lastCountedFrame>=COUNT_EVERY_IMAGES&&ensureReadback(queueDevice);
     let tested=0,oversized=0,oversizedTriangles=0,testedTriangles=0;
     for(let i=0;i<count;i++){
      const base=i*8,at=i*HIZ_BOUNDS_VALUES;
      // The rectangle handed to the kernel is the one clipped to the viewport, in texels of the mip
      // that covers it exactly; `hizTestRectFlat` is the same call the CPU oracle makes, so the two
      // read the same texels of the same level.
      const testable=hizTestRectFlat(next,at,gpu.width,gpu.height,sizes.length,testRect);
      const level=testable?testRect[0]:0,scale=2**level;
      testI32[base]=testable?Math.floor(testRect[1]/scale):0;testI32[base+1]=testable?Math.floor(testRect[2]/scale):0;
      testI32[base+2]=testable?Math.floor(testRect[3]/scale):0;testI32[base+3]=testable?Math.floor(testRect[4]/scale):0;
      testF32[base+4]=next[at+4];testU32[base+5]=((rows[i]<<1)|(testable?0:1))>>>0;
      testU32[base+6]=testable?offsets[level]:0;testU32[base+7]=testable?sizes[level][0]:gpu.width;
      if(!due)continue;
      const triangles=sample!.triangles[i]??0;
      tested++;testedTriangles+=triangles;
      sampledRows[i]=rows[i];sampledTriangles[i]=triangles;
      if(hizOversizedFlat(next,at)){oversized++;oversizedTriangles+=triangles;}
     }
     if(count)queueDevice.queue.writeBuffer(bounds,0,testBytes,0,count*32);
     const biasBits=new Uint32Array(new Float32Array([0]).buffer)[0];
     const testSlot=MAX_LEVELS+1;
     writeUni(queueDevice,uniforms,uniData,[gpu.width,gpu.height,count,biasBits],testSlot*UNIFORM_BYTES);
     const pass=encoder.beginComputePass({label:'WG HiZ test'});
     pass.setPipeline(testPipeline);pass.setBindGroup(0,bindGroup,[testSlot*UNIFORM_BYTES]);
     pass.dispatchWorkgroups(Math.max(1,Math.ceil(count/TEST_WORKGROUP)));
     pass.end();
     if(due&&readback){
      sampledCount=count;sampledFrame=sample!.frame;
      sampledTested=tested;sampledOversized=oversized;sampledTestedTriangles=testedTriangles;sampledOversizedTriangles=oversizedTriangles;
      readbackRows=Math.min(cap,flagRows);
      encoder.copyBufferToBuffer(flags,0,readback,0,readbackRows*4);
      copyEncoded=true;lastCountedFrame=sample!.frame;
     }
     return count;
    },
    countsSubmitted(){
     const buffer=readback;
     if(!copyEncoded||!buffer||disposed)return;
     copyEncoded=false;mapping=true;
     const rowsRead=readbackRows;
     Promise.resolve(buffer.mapAsync(mapRead(),0,rowsRead*4)).then(()=>{
      if(disposed)return;
      const verdicts=new Uint32Array(buffer.getMappedRange(0,rowsRead*4));
      let rejected=0,rejectedTriangles=0;
      for(let i=0;i<sampledCount;i++){
       const row=sampledRows[i];
       if(row<rowsRead&&verdicts[row]){rejected++;rejectedTriangles+=sampledTriangles[i];}
      }
      counted.frame=sampledFrame;counted.tested=sampledTested;counted.oversized=sampledOversized;
      counted.testedTriangles=sampledTestedTriangles;counted.oversizedTriangles=sampledOversizedTriangles;
      counted.rejected=rejected;counted.rejectedTriangles=rejectedTriangles;
      countedReady=true;
     }).catch(()=>{/* A device loss or a disposal cancels a mapping; the counters keep their last image. */})
      .finally(()=>{try{buffer.unmap();}catch{/* Already unmapped by a disposal. */}mapping=false;});
    },
    counts(){return countedReady?counted:undefined;},
    resize(nextDevice,nextWidth,nextHeight){
     if(disposed||!nextDevice||nextWidth<1||nextHeight<1)return false;
     if(nextWidth===gpu.width&&nextHeight===gpu.height&&level0)return true;
     try{
      if(!alloc(nextWidth,nextHeight)||!level0||!level0View)return false;
      gpu.width=nextWidth;gpu.height=nextHeight;gpu.level0=level0;gpu.level0View=level0View;
      return true;
     }catch{return false;}
    },
    dispose(){
     disposed=true;countedReady=false;copyEncoded=false;
     readback?.destroy();readback=undefined;
     for(const buffer of buffers)buffer.destroy();
     level0?.destroy();pyramid?.destroy();
     level0=undefined;level0View=undefined;pyramid=undefined;bindGroup=undefined;
    },
   };
   return gpu;
  }catch{
   if(typeof device.popErrorScope==='function')await device.popErrorScope().catch(()=>{});
   for(const buffer of buffers)try{buffer.destroy();}catch{/* Partial Hi-Z setup must not leak. */}
   try{level0?.destroy();}catch{/* */}
   try{pyramid?.destroy();}catch{/* */}
   return undefined;
  }
}
