import test from 'node:test';
import assert from 'node:assert/strict';
import {createGpuTiming} from './gpuTiming.ts';

function fixture(supported=true){
 Object.assign(globalThis,{GPUBufferUsage:{QUERY_RESOLVE:1,COPY_SRC:2,COPY_DST:4,MAP_READ:8},GPUMapMode:{READ:1}});
 const descriptors:any[]=[],ops:string[]=[],buffers:any[]=[];let destroys=0;
 const device={features:new Set(supported?['timestamp-query']:[]),createQuerySet:()=>({destroy(){destroys++;}}),createBuffer:()=>{const data=new BigUint64Array(128);data.set([1000000n,3000000n,4000000n,7000000n]);const buffer={mapAsync:async()=>{},getMappedRange:()=>data.buffer,unmap(){},destroy(){destroys++;}};buffers.push(buffer);return buffer;},createCommandEncoder:()=>({beginRenderPass(d:any){descriptors.push(d);return {end(){}};},beginComputePass(d:any){descriptors.push(d);return {end(){}};},resolveQuerySet(){ops.push('resolve');},copyBufferToBuffer(){ops.push('copy');},finish(){ops.push('finish');return {};}})} as unknown as GPUDevice;
 return {device,descriptors,ops,buffers,destroys:()=>destroys};
}
test('GPU timing converts pass timestamps to ms and preserves the sampled submission',async()=>{
 const f=fixture(),timer=createGpuTiming(f.device),encoder=timer.createEncoder(1);
 encoder.beginRenderPass({label:'lighting',colorAttachments:[]}).end();encoder.beginComputePass({label:'hiz'}).end();encoder.finish();
 assert.equal(f.descriptors[0].timestampWrites.beginningOfPassWriteIndex,0);
 assert.equal(f.descriptors[1].timestampWrites.endOfPassWriteIndex,3);
 assert.deepEqual(f.ops,['resolve','copy','finish']);
 timer.submitted(encoder,{frame:1,submission:7});await timer.flush();
 const events=timer.drain();assert.equal(events.length,1);assert.equal(events[0].frame,1);assert.equal(events[0].submission,7);
 assert.deepEqual(events[0].passes,[{name:'lighting',gpuMs:2},{name:'hiz',gpuMs:3}]);assert.equal(events[0].sumPassMs,5);
 timer.dispose();assert.equal(f.destroys(),3);
});
test('unsupported timestamps allocate nothing and unavailable GPU duration stays null',()=>{
 const f=fixture(false),timer=createGpuTiming(f.device),encoder=timer.createEncoder(1);encoder.beginComputePass({label:'plain'});encoder.finish();timer.submitted(encoder,{frame:1});
 assert.equal(timer.supported,false);assert.equal(f.buffers.length,0);assert.equal(f.descriptors[0].timestampWrites,undefined);assert.deepEqual(timer.drain(),[]);timer.dispose();
});
test('missing or reversed timestamps invalidate only that pass and subsequent frames remain measurable',async()=>{
 const f=fixture(),timer=createGpuTiming(f.device),encoder=timer.createEncoder(1);
 encoder.beginComputePass({label:'empty'}).end();encoder.beginComputePass({label:'lighting'}).end();encoder.finish();
 const values=new BigUint64Array(f.buffers[1].getMappedRange());values[1]=0n;
 timer.submitted(encoder,{frame:1});await timer.flush();
 const sample=timer.drain()[0];assert.equal(sample.passes[0].gpuMs,null);assert.equal(sample.passes[0].reason,'invalid-timestamps');assert.equal(sample.passes[1].gpuMs,3);assert.equal(sample.sumPassMs,null);assert.equal(timer.supported,true);
 values[1]=3000000n;const next=timer.createEncoder(61);next.beginComputePass({label:'next'}).end();next.finish();timer.submitted(next,{frame:61});await timer.flush();assert.equal(timer.drain()[0].sumPassMs,2);timer.dispose();
});
test('GPU timing skips busy frames, bounds passes and survives readback failure',async()=>{
 const f=fixture(),timer=createGpuTiming(f.device),encoder=timer.createEncoder(1);
 for(let i=0;i<70;i++)encoder.beginComputePass({label:'hiz'}).end();encoder.finish();
 assert.equal(f.descriptors.filter(d=>d.timestampWrites).length,64);
 const busy=timer.createEncoder(61);busy.beginComputePass({label:'busy'});assert.equal(f.descriptors.at(-1).timestampWrites,undefined);
 f.buffers[1].mapAsync=async()=>{throw Error('MAP_FAILED');};timer.submitted(encoder,{frame:1});await timer.flush();
 const event=timer.drain()[0];assert.equal(event.sumPassMs,null);assert.match(String(event.error),/MAP_FAILED/);assert.equal(timer.supported,false);timer.dispose();
});
