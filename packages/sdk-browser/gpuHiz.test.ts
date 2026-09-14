import test from 'node:test';import assert from 'node:assert/strict';
import {HIZ_BACKGROUND,hizBuildPyramid,hizReduceCeil} from '../sdk-core/index.ts';
import {HIZ_BOUNDS_VALUES,buildHizPyramid,createHizCounts,hizOversized,hizRejects,type HizBounds} from './hiz.ts';
import {createGpuHiz,evaluateHizReduce,evaluateHizTest,hizLevelSizes,HIZ_SHADER,packHizPyramid} from './gpuHiz.ts';

test('Hi-Z level sizes reduce by ceil 2 until a single texel',()=>{
 assert.deepEqual(hizLevelSizes(32,32),[[32,32],[16,16],[8,8],[4,4],[2,2],[1,1]]);
 assert.deepEqual(hizLevelSizes(3,3),[[3,3],[2,2],[1,1]]);
 assert.deepEqual(hizLevelSizes(1,1),[[1,1]]);
});

test('packed GPU pyramid matches the JS ceil-max oracle including a background hole',()=>{
 const depth=[[0.2,0.3],[0.4,HIZ_BACKGROUND]];
 const packed=packHizPyramid(depth);
 const reduced=evaluateHizReduce(packed.data,packed.sizes[0][0],packed.sizes[0][1]);
 assert.deepEqual(hizReduceCeil(depth),[[HIZ_BACKGROUND]]);
 assert.equal(reduced.width,1);
 assert.equal(reduced.height,1);
 assert.equal(reduced.data[0],HIZ_BACKGROUND);
 assert.deepEqual(hizBuildPyramid(depth).map(level=>level.map(row=>[...row])),hizBuildPyramid(depth));
});

test('GPU Hi-Z test kernel matches hizRejects and never rejects a background hole or a near clip',()=>{
 const depth=new Float32Array(4);depth.set([0.2,0.3,0.4,HIZ_BACKGROUND]);
 const pyramid=buildHizPyramid(depth,2,2);
 const packed=packHizPyramid(pyramid.levels[0]);
 const hole:HizBounds={minX:0,minY:0,maxX:1,maxY:1,nearestDepth:0.8,clipsNear:false};
 const near:HizBounds={minX:0,minY:0,maxX:1,maxY:1,nearestDepth:0.8,clipsNear:true};
 const edge:HizBounds={minX:0,minY:0,maxX:2,maxY:2,nearestDepth:0.8,clipsNear:false};
 const closed=buildHizPyramid(new Float32Array([0.2,0.3,0.4,0.5]),2,2);
 const closedPacked=packHizPyramid(closed.levels[0]);
 const occluded:HizBounds={minX:0,minY:0,maxX:1,maxY:1,nearestDepth:0.8,clipsNear:false};
 const equal:HizBounds={minX:0,minY:0,maxX:1,maxY:1,nearestDepth:0.5,clipsNear:false};
 const flags=evaluateHizTest(packed, [hole,near,edge]);
 assert.equal(hizRejects(pyramid,hole),false);
 assert.deepEqual([...flags],[0,0,0]);
 const closedFlags=evaluateHizTest(closedPacked,[occluded,equal,near]);
 assert.equal(hizRejects(closed,occluded),true);
 assert.equal(hizRejects(closed,equal),false);
 assert.deepEqual([...closedFlags],[1,0,0]);
});

test('an integer-edge max is inclusive so a hole on that pixel cannot hide',()=>{
 const depth=new Float32Array(16);depth.fill(0.2);depth[2*4+2]=HIZ_BACKGROUND;
 const pyramid=buildHizPyramid(depth,4,4);
 const packed=packHizPyramid(pyramid.levels[0]);
 const bounds:HizBounds={minX:0,minY:0,maxX:2,maxY:2,nearestDepth:0.8,clipsNear:false};
 assert.equal(hizRejects(pyramid,bounds),false);
 assert.deepEqual([...evaluateHizTest(packed,[bounds])],[0]);
});

test('a covered 33 by 19 footprint can reject through a reduced Hi-Z level',()=>{
 const depth=new Float32Array(33*19);depth.fill(0.2);
 const pyramid=buildHizPyramid(depth,33,19);
 const bounds:HizBounds={minX:0,minY:0,maxX:32,maxY:18,nearestDepth:0.8,clipsNear:false};
 assert.equal(hizRejects(pyramid,bounds),true);
 assert.deepEqual([...evaluateHizTest(packHizPyramid(pyramid.levels[0]),[bounds])],[1]);
});

test('a background pixel at the far edge of a large footprint prevents rejection',()=>{
 const depth=new Float32Array(33*19);depth.fill(0.2);depth[18*33+32]=HIZ_BACKGROUND;
 const pyramid=buildHizPyramid(depth,33,19);
 const bounds:HizBounds={minX:0,minY:0,maxX:32,maxY:18,nearestDepth:0.8,clipsNear:false};
 assert.equal(hizRejects(pyramid,bounds),false);
 assert.deepEqual([...evaluateHizTest(packHizPyramid(pyramid.levels[0]),[bounds])],[0]);
});

test('a footprint straddling the edge is judged on the part that can paint a pixel',()=>{
 const depth=new Float32Array(33*19);depth.fill(0.2);
 const pyramid=buildHizPyramid(depth,33,19);
 // Columns 33 and beyond do not exist, so they cannot show this box: what is inside decides.
 const covered:HizBounds={minX:-4,minY:0,maxX:40,maxY:18,nearestDepth:0.8,clipsNear:false};
 assert.equal(hizRejects(pyramid,covered),true);
 assert.deepEqual([...evaluateHizTest(packHizPyramid(pyramid.levels[0]),[covered])],[1]);
 // A hole inside the viewport still forbids the rejection, edge or no edge.
 const holed=new Float32Array(33*19);holed.fill(0.2);holed[18*33+32]=HIZ_BACKGROUND;
 const holedPyramid=buildHizPyramid(holed,33,19);
 assert.equal(hizRejects(holedPyramid,covered),false);
 assert.deepEqual([...evaluateHizTest(packHizPyramid(holedPyramid.levels[0]),[covered])],[0]);
});

test('a footprint wholly outside the depth target is never rejected',()=>{
 const depth=new Float32Array(33*19);depth.fill(0.2);
 const pyramid=buildHizPyramid(depth,33,19);
 const outside:HizBounds={minX:40,minY:0,maxX:48,maxY:18,nearestDepth:0.8,clipsNear:false};
 assert.equal(hizRejects(pyramid,outside),false);
 assert.deepEqual([...evaluateHizTest(packHizPyramid(pyramid.levels[0]),[outside])],[0]);
});

test('Hi-Z compute shader declares this-frame max reduction with background 1',()=>{
 assert.match(HIZ_SHADER,/@compute[\s\S]*fn copyDepth/);
 assert.match(HIZ_SHADER,/@compute[\s\S]*fn reduceHiz/);
 assert.match(HIZ_SHADER,/@compute[\s\S]*fn testHiz/);
 assert.match(HIZ_SHADER,/max\(/);
 assert.match(HIZ_SHADER,/texture_2d<f32>/);
 assert.doesNotMatch(HIZ_SHADER,/texture_depth_2d/);
 assert.match(HIZ_SHADER,/array<f32>/);
});

test('missing compute leaves GPU Hi-Z undefined so the visbuffer cut stays conservative',async()=>{
 assert.equal(await createGpuHiz({} as GPUDevice,32,32,4),undefined);
});

test('a Hi-Z resize replaces the this-frame level-0 depth target',async()=>{
 Object.assign(globalThis,{
  GPUBufferUsage:{MAP_READ:1,COPY_DST:8,UNIFORM:64,STORAGE:128},
  GPUTextureUsage:{TEXTURE_BINDING:4,RENDER_ATTACHMENT:16},
  GPUShaderStage:{COMPUTE:4},
 });
 const textures:Array<{format?:string}>=[];
 const device={
  createBuffer:({size}:{size:number})=>({size,destroy(){}}),
  createTexture:({format}:{format?:string})=>{const tex={format,destroy(){},createView(){return {format};}};textures.push(tex);return tex;},
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
  createBindGroupLayout:()=>({}),
  createPipelineLayout:()=>({}),
  createComputePipeline:({compute}:{compute:{entryPoint:string}})=>compute,
  createBindGroup:()=>({}),
  queue:{writeBuffer(){}},
 } as unknown as GPUDevice;
 const hiz=await createGpuHiz(device,16,16,4);
 assert.ok(hiz);
 const first=hiz.level0;
 assert.equal(hiz.resize(device,32,32),true);
 assert.notEqual(hiz.level0,first);
 assert.equal(hiz.width,32);
 assert.equal(hiz.height,32);
 assert.ok(textures.filter(texture=>texture.format==='r32float').length>=2);
 hiz.dispose();
});

test('GPU Hi-Z encodes a large bound into its reduced level',async()=>{
 const writes:Array<{size:number;data:ArrayBuffer}>=[];
 const device={
  createBuffer:({size}:{size:number})=>({size,destroy(){}}),
  createTexture:({format}:{format?:string})=>({format,destroy(){},createView(){return {format};}}),
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
  createBindGroupLayout:()=>({}),createPipelineLayout:()=>({}),
  createComputePipeline:({compute}:{compute:{entryPoint:string}})=>compute,
  createBindGroup:()=>({}),
  queue:{writeBuffer(buffer:{size:number},_offset:number,data:ArrayBuffer,_start:number,length:number){
   writes.push({size:buffer.size,data:data.slice(0,length)});
  }},
 } as unknown as GPUDevice;
 const cleared:Array<{size:number;bytes:number}>=[];
 const encoder={clearBuffer(buffer:{size:number},_offset:number,size:number){cleared.push({size:buffer.size,bytes:size});},
  beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};}} as unknown as GPUCommandEncoder;
 const hiz=await createGpuHiz(device,33,19,2);assert.ok(hiz);
 // Flat bounds, and the box answers for row 1: the verdict lands at the row, not at its rank.
 const bounds=new Float64Array([0,0,32,18,0.8,0]);
 hiz.encodeTest(device,encoder,bounds,new Uint32Array([1]),1,2);
 // The rows the frame does not test are cleared first, so none of them keeps an earlier verdict.
 assert.deepEqual(cleared,[{size:8,bytes:8}]);
 const write=writes.find(item=>item.size===64);assert.ok(write);
 assert.deepEqual([...new Int32Array(write.data).slice(0,4)],[0,0,8,4]);
 assert.deepEqual([...new Uint32Array(write.data).slice(5,8)],[2,797,9]);
 hiz.dispose();
});

test('GPU Hi-Z allocates only the current pyramid and releases it on resize',async()=>{
 const buffers:Array<{size:number;destroyed:boolean}>=[];
 const device={
  createBuffer:({size}:{size:number})=>{const buffer={size,destroyed:false,destroy(){buffer.destroyed=true;}};buffers.push(buffer);return buffer;},
  createTexture:({format}:{format?:string})=>({format,destroy(){},createView(){return {format};}}),
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
  createBindGroupLayout:()=>({}),
  createPipelineLayout:()=>({}),
  createComputePipeline:({compute}:{compute:{entryPoint:string}})=>compute,
  createBindGroup:()=>({}),
  queue:{writeBuffer(){}},
 } as unknown as GPUDevice;
 const hiz=await createGpuHiz(device,16,16,4);assert.ok(hiz);
 assert.equal(buffers.length,4);
 const firstPyramid=buffers[3];
 assert.equal(hiz.resize(device,32,32),true);
 assert.equal(firstPyramid.destroyed,true);
 hiz.dispose();
 assert.ok(buffers.every(buffer=>buffer.destroyed));
});

/**
 * A device that answers the counter readback with the verdicts the kernel's JS twin computes for the
 * same boxes. The counting machinery is what is under test: fed the GPU's own verdicts, it must
 * report exactly what the CPU oracle counts over the same fixed image.
 */
function countingDevice(verdicts:Uint32Array){
 const copies:Array<{bytes:number}>=[];
 const device={
  createBuffer:({size,label}:{size:number;label?:string})=>label==='WG HiZ counts readback'
   ?{size,label,destroy(){},async mapAsync(){},getMappedRange(offset:number,length:number){return verdicts.buffer.slice(offset,offset+length);},unmap(){}}
   :{size,label,destroy(){}},
  createTexture:({format}:{format?:string})=>({format,destroy(){},createView(){return {format};}}),
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
  createBindGroupLayout:()=>({}),createPipelineLayout:()=>({}),
  createComputePipeline:({compute}:{compute:{entryPoint:string}})=>compute,
  createBindGroup:()=>({}),
  queue:{writeBuffer(){}},
 } as unknown as GPUDevice;
 const encoder={
  clearBuffer(){},
  copyBufferToBuffer(_src:unknown,_srcOffset:number,_dst:unknown,_dstOffset:number,bytes:number){copies.push({bytes});},
  beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},
 } as unknown as GPUCommandEncoder;
 return {device,encoder,copies};
}

test('GPU Hi-Z counters report the same clusters and triangles as the CPU oracle on a fixed image',async()=>{
 const depth=new Float32Array(33*19);depth.fill(0.2);
 const pyramid=buildHizPyramid(depth,33,19);
 // A wide covered box, a box that crosses the near plane, and a small covered one.
 const boxes:HizBounds[]=[
  {minX:0,minY:0,maxX:32,maxY:18,nearestDepth:0.8,clipsNear:false},
  {minX:0,minY:0,maxX:0,maxY:0,nearestDepth:0.8,clipsNear:true},
  {minX:4,minY:4,maxX:5,maxY:5,nearestDepth:0.8,clipsNear:false},
 ];
 const triangles=[128,64,32],rows=new Uint32Array([2,0,1]);
 const flat=new Float64Array(boxes.length*HIZ_BOUNDS_VALUES);
 boxes.forEach((box,i)=>{
  const at=i*HIZ_BOUNDS_VALUES;
  flat[at]=box.minX;flat[at+1]=box.minY;flat[at+2]=box.maxX;flat[at+3]=box.maxY;
  flat[at+4]=box.nearestDepth;flat[at+5]=box.clipsNear?1:0;
 });
 // The CPU oracle over the same fixed image, box by box.
 const oracle=createHizCounts();
 const kernel=evaluateHizTest(packHizPyramid(pyramid.levels[0]),boxes);
 boxes.forEach((box,i)=>{
  oracle.tested++;oracle.testedTriangles+=triangles[i];
  if(hizOversized(box.minX,box.minY,box.maxX,box.maxY,box.clipsNear)){oracle.oversized++;oracle.oversizedTriangles+=triangles[i];}
  if(hizRejects(pyramid,box)){oracle.rejected++;oracle.rejectedTriangles+=triangles[i];}
 });
 assert.deepEqual([...kernel],boxes.map(box=>hizRejects(pyramid,box)?1:0));
 assert.equal(oracle.rejected,2);
 assert.equal(oracle.oversized,1);
 // The kernel writes its verdict at the row each box answers for, not at the box's rank.
 const verdicts=new Uint32Array(4);
 boxes.forEach((_,i)=>{verdicts[rows[i]]=kernel[i];});
 const {device,encoder,copies}=countingDevice(verdicts);
 const hiz=await createGpuHiz(device,33,19,8);assert.ok(hiz);
 assert.equal(hiz.counts(),undefined);
 hiz.encodeTest(device,encoder,flat,rows,boxes.length,4,{triangles,frame:0});
 assert.deepEqual(copies,[{bytes:16}]);
 hiz.countsSubmitted();
 await new Promise(resolve=>setTimeout(resolve,0));
 const counts=hiz.counts();assert.ok(counts);
 assert.equal(counts.frame,0);
 assert.deepEqual({tested:counts.tested,rejected:counts.rejected,oversized:counts.oversized,
  testedTriangles:counts.testedTriangles,rejectedTriangles:counts.rejectedTriangles,oversizedTriangles:counts.oversizedTriangles},oracle);
 hiz.dispose();
});

test('an image that hands no count sample copies nothing back and keeps the last counted image',async()=>{
 const {device,encoder,copies}=countingDevice(new Uint32Array([1,0,0,0]));
 const hiz=await createGpuHiz(device,33,19,8);assert.ok(hiz);
 const flat=new Float64Array(HIZ_BOUNDS_VALUES);flat[2]=1;flat[3]=1;flat[4]=0.8;
 hiz.encodeTest(device,encoder,flat,new Uint32Array([0]),1,4);
 assert.deepEqual(copies,[]);
 assert.equal(hiz.counts(),undefined);
 hiz.countsSubmitted();
 assert.equal(hiz.counts(),undefined);
 // The interval gates the next sample: the image right after a counted one copies nothing.
 hiz.encodeTest(device,encoder,flat,new Uint32Array([0]),1,4,{triangles:[7],frame:0});
 hiz.countsSubmitted();
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(copies.length,1);
 hiz.encodeTest(device,encoder,flat,new Uint32Array([0]),1,4,{triangles:[7],frame:1});
 assert.equal(copies.length,1);
 assert.equal(hiz.counts()?.frame,0);
 hiz.dispose();
});
