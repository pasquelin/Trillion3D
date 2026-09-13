import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {DRAW_SHADER,evaluateDrawCompact,indirectForDraw} from '../packages/sdk-browser/gpuDraw.ts';

const labRoot=process.env.LAB_ROOT??resolve('../render-tech-lab');
const {chromium}=createRequire(resolve(labRoot,'package.json'))('playwright');
const items=Array.from({length:130},(_,i)=>({pageIndex:i+17,bin:(i*7%3),rest:(i*11%2)}));
const expected=evaluateDrawCompact(items,96,192);
const server=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><title>WebGeometry GPU compact</title>');});
await new Promise((ready,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',ready);});
const address=server.address();if(!address||typeof address==='string')throw Error('HTTP listener unavailable');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${address.port}/`);
 const result=await page.evaluate(async({shader,items})=>{
  const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {unavailable:'No WebGPU adapter'};
  const device=await adapter.requestDevice();const errors=[];
  device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
  const module=device.createShaderModule({code:shader});
  const info=await module.getCompilationInfo();
  const compilationErrors=info.messages.filter(message=>message.type==='error').map(message=>message.message);
  if(compilationErrors.length)return {compilationErrors,errors};
  const cap=192,groups=Math.ceil(cap/64),usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
  const itemBuffer=device.createBuffer({size:cap*12,usage});
  const uniform=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const instances=device.createBuffer({size:cap*4,usage});
  const indirect=device.createBuffer({size:96,usage:usage|GPUBufferUsage.INDIRECT});
  const counts=device.createBuffer({size:groups*24,usage});
  const offsets=device.createBuffer({size:groups*24,usage});
  const instRead=device.createBuffer({size:cap*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
  const cmdRead=device.createBuffer({size:96,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
  const layout=device.createBindGroupLayout({entries:[
   {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
   {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
   ...[2,3,4,5].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}})),
  ]});
  const group=device.createBindGroup({layout,entries:[itemBuffer,uniform,instances,indirect,counts,offsets].map((buffer,binding)=>({binding,resource:{buffer}}))});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const pipelines=['countGroups','prefixGroups','scatterGroups'].map(entryPoint=>device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint}}));
  const words=new Uint32Array(items.length*3);
  for(let i=0;i<items.length;i++){words[i*3]=items[i].pageIndex;words[i*3+1]=items[i].bin;words[i*3+2]=items[i].rest;}
  device.queue.writeBuffer(itemBuffer,0,words);
  device.queue.writeBuffer(uniform,0,new Uint32Array([items.length,96,cap,groups]));
  const encoder=device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setBindGroup(0,group);
  for(let i=0;i<3;i++){pass.setPipeline(pipelines[i]);pass.dispatchWorkgroups(i===1?1:i===0?Math.ceil(groups*6/64):Math.ceil(items.length/64));}
  pass.end();encoder.copyBufferToBuffer(instances,0,instRead,0,cap*4);encoder.copyBufferToBuffer(indirect,0,cmdRead,0,96);
  device.queue.submit([encoder.finish()]);
  await Promise.all([instRead.mapAsync(GPUMapMode.READ),cmdRead.mapAsync(GPUMapMode.READ)]);
  const instanceIds=[...new Uint32Array(instRead.getMappedRange().slice(0,items.length*4))];
  const commands=[...new Uint32Array(cmdRead.getMappedRange().slice(0))];
  instRead.unmap();cmdRead.unmap();device.destroy();
  return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture},instanceIds,commands,errors};
 },{shader:DRAW_SHADER,items});
 assert.ok(!result.unavailable,result.unavailable);
 assert.deepEqual(result.compilationErrors??[],[]);
 assert.deepEqual(result.errors,[]);
 assert.deepEqual(result.instanceIds,[...expected.instances]);
 assert.deepEqual(result.commands,[...indirectForDraw(expected)]);
 console.log(JSON.stringify({status:'passed',adapter:result.adapter,pages:items.length,groups:3}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
