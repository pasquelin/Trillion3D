import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DRAW_SHADER,evaluateDrawCompact,indirectForDraw} from '../packages/sdk-browser/gpuDraw.ts';
import {VIS_SHADER,PAGE_INFO_STRIDE} from '../packages/sdk-browser/visibilityBuffer.ts';

const labRoot=process.env.LAB_ROOT??resolve('../render-tech-lab');
const {chromium}=createRequire(resolve(labRoot,'package.json'))('playwright');
const cap=192,maxVertexCount=3;
// Canonical page IDs deliberately differ from both input and compacted positions.
const items=Array.from({length:130},(_,i)=>({pageIndex:17+(i*37%130),bin:(i*7%3),rest:(i*11%2),selectionIndex:i}));
const cases=[
 {name:'six mixed slots across three workgroups',items},
 {name:'selection mask filters before scatter',items,mask:Array.from({length:cap},(_,i)=>i%4<2?1:0)},
 {name:'selection mask rejects all pages',items,mask:Array(cap).fill(0)},
 {name:'sparse slots replace previous contents',items:items.filter(item=>item.bin===1).slice(0,7)},
 {name:'empty replaces previous contents',items:[]},
 {name:'overflow emits no draws',items:Array.from({length:cap+1},(_,i)=>items[i%items.length])},
];
const selectedItems=sample=>sample.mask?sample.items.filter(item=>sample.mask[item.selectionIndex]!==0):sample.items;
const expected=cases.map(sample=>evaluateDrawCompact(selectedItems(sample),maxVertexCount,cap));
const server=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><title>WebGeometry GPU scatter to visibility</title>');});
await new Promise((ready,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',ready);});
const address=server.address();if(!address||typeof address==='string')throw Error('HTTP listener unavailable');
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={startedAt:new Date().toISOString(),shaders:{draw:createHash('sha256').update(DRAW_SHADER).digest('hex'),visibility:createHash('sha256').update(VIS_SHADER).digest('hex')}};
try{
 const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${address.port}/`);
 const result=await page.evaluate(async({shader,visShader,cases,cap,maxVertexCount,pageStride})=>{
  const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {unavailable:'No WebGPU adapter'};
  // Deliberately do not request indirect-first-instance: slot starts must come from storage.
  const device=await adapter.requestDevice();const errors=[];
  device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
  const module=device.createShaderModule({code:shader}),visModule=device.createShaderModule({code:visShader});
  const infos=await Promise.all([module.getCompilationInfo(),visModule.getCompilationInfo()]);
  const compilationErrors=infos.flatMap(info=>info.messages.filter(message=>message.type==='error').map(message=>message.message));
  if(compilationErrors.length){device.destroy();return {compilationErrors,errors};}
  const groups=Math.ceil(cap/64),usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
  const makeBuffer=(size,bufferUsage=usage)=>device.createBuffer({size,usage:bufferUsage});
  const itemBuffer=makeBuffer(cap*16),uniform=makeBuffer(32,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const instances=makeBuffer(cap*4),indirect=makeBuffer(96,usage|GPUBufferUsage.INDIRECT);
  const selectionOffset=11;
  const counts=makeBuffer(groups*24),offsets=makeBuffer(groups*24),selection=makeBuffer((cap+selectionOffset)*4);
  const readUsage=GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST;
  const instRead=makeBuffer(cap*4,readUsage),cmdRead=makeBuffer(96,readUsage),offsetRead=makeBuffer(24,readUsage);
  const layout=device.createBindGroupLayout({entries:[
   {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
   {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
   ...[2,3,4,5].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}})),
   {binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
  ]});
  const group=device.createBindGroup({layout,entries:[itemBuffer,uniform,instances,indirect,counts,offsets,selection].map((buffer,binding)=>({binding,resource:{buffer}}))});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const pipelines=['countGroups','prefixGroups','scatterGroups'].map(entryPoint=>device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint}}));

  const pageCount=147,columns=16,rows=10,width=256,height=160;
  const table=new Float32Array(pageCount*pageStride/4),tableInts=new Uint32Array(table.buffer);
  for(let pageIndex=0;pageIndex<pageCount;pageIndex++){
   const base=pageIndex*pageStride/4;
   table.set([.8/columns,0,0,0,0,.8/rows,0,0,0,0,1,0,(pageIndex%columns+.5)*2/columns-1,1-(Math.floor(pageIndex/columns)+.5)*2/rows,0,1],base);
   tableInts[base+25]=3;tableInts[base+27]=(pageIndex+1)<<16;tableInts[base+31]=0xffffffff;
  }
  const pageTable=makeBuffer(table.byteLength),indices=makeBuffer(12),positions=makeBuffer(36),flags=makeBuffer(4),uvs=makeBuffer(24);
  device.queue.writeBuffer(pageTable,0,table);device.queue.writeBuffer(indices,0,new Uint32Array([0,1,2]));
  device.queue.writeBuffer(positions,0,new Float32Array([-1,-1,.5,1,-1,.5,0,1,.5]));
  const maps=device.createTexture({size:[1,1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING});
  const mapsView=maps.createView({dimension:'2d-array'}),sampler=device.createSampler();
  const visLayout=device.createBindGroupLayout({entries:[
   ...[0,1,3,5,8,9].map(binding=>({binding,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}})),
   {binding:2,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
   {binding:4,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}},
   {binding:6,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d-array'}},
   {binding:7,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
  ]});
  const visPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[visLayout]});
  const visPipelines=['vis_vs','vis_hiz_vs'].map(entryPoint=>device.createRenderPipeline({layout:visPipelineLayout,vertex:{module:visModule,entryPoint},fragment:{module:visModule,entryPoint:'vis_fs',targets:[{format:'r32uint'}]},primitive:{topology:'triangle-list',cullMode:'none'}}));
  const visGroups=[];
  for(let slot=0;slot<7;slot++){
   const bytes=new ArrayBuffer(96),f32=new Float32Array(bytes),u32=new Uint32Array(bytes);
   f32.set([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);u32[20]=slot%6;u32[21]=slot<6?1:0;
   const visUniform=makeBuffer(96,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(visUniform,0,bytes);
   visGroups.push(device.createBindGroup({layout:visLayout,entries:[
    ...[indices,positions,pageTable,flags,visUniform,uvs].map((buffer,binding)=>({binding,resource:{buffer}})),
    {binding:6,resource:mapsView},{binding:7,resource:sampler},
    {binding:8,resource:{buffer:instances}},{binding:9,resource:{buffer:offsets}},
   ]}));
  }
  const target=device.createTexture({size:[width,height,7],format:'r32uint',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const views=Array.from({length:7},(_,slot)=>target.createView({dimension:'2d',baseArrayLayer:slot,arrayLayerCount:1}));
  const imageBytes=width*height*4,pixelsRead=makeBuffer(imageBytes*7,readUsage),directPage=122;
  const results=[];
  for(const sample of cases){
   const n=Math.min(sample.items.length,cap),words=new Uint32Array(n*4);
   for(let i=0;i<n;i++){words[i*4]=sample.items[i].pageIndex;words[i*4+1]=sample.items[i].bin;words[i*4+2]=sample.items[i].rest;words[i*4+3]=sample.items[i].selectionIndex;}
   if(n)device.queue.writeBuffer(itemBuffer,0,words);
   if(sample.mask){const mask=new Uint32Array(cap+selectionOffset).fill(1);mask.set(sample.mask,selectionOffset);device.queue.writeBuffer(selection,0,mask);}
   device.queue.writeBuffer(uniform,0,new Uint32Array([sample.items.length,maxVertexCount,cap,groups,sample.mask?1:0,selectionOffset,0,0]));
   const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setBindGroup(0,group);
   for(let i=0;i<3;i++){pass.setPipeline(pipelines[i]);pass.dispatchWorkgroups(i===1?1:i===0?Math.ceil(groups*6/64):Math.max(1,Math.ceil(n/64)));}
   pass.end();
   // Compute output is consumed in the same submission, without a CPU readback/reorder.
   for(let slot=0;slot<7;slot++){
    const render=encoder.beginRenderPass({colorAttachments:[{view:views[slot],clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
    render.setPipeline(visPipelines[slot>=3&&slot<6?1:0]);render.setBindGroup(0,visGroups[slot]);
    if(slot<6)render.drawIndirect(indirect,slot*16);else render.draw(3,1,0,directPage);
    render.end();
   }
   encoder.copyBufferToBuffer(instances,0,instRead,0,cap*4);encoder.copyBufferToBuffer(indirect,0,cmdRead,0,96);encoder.copyBufferToBuffer(offsets,0,offsetRead,0,24);
   encoder.copyTextureToBuffer({texture:target},{buffer:pixelsRead,bytesPerRow:width*4,rowsPerImage:height},[width,height,7]);
   device.queue.submit([encoder.finish()]);
   await Promise.all([instRead,cmdRead,offsetRead,pixelsRead].map(buffer=>buffer.mapAsync(GPUMapMode.READ)));
   const commands=[...new Uint32Array(cmdRead.getMappedRange().slice(0))],slotOffsets=[...new Uint32Array(offsetRead.getMappedRange().slice(0))];
   const instanceCount=commands.reduce((sum,word,i)=>sum+(i%4===1?word:0),0);
   const instanceIds=[...new Uint32Array(instRead.getMappedRange().slice(0,instanceCount*4))];
   const pixels=new Uint32Array(pixelsRead.getMappedRange()),visiblePages=[];
   for(let slot=0;slot<7;slot++)visiblePages.push([...new Set(pixels.subarray(slot*width*height,(slot+1)*width*height))].filter(id=>id!==0).map(id=>(id>>>16)-1).sort((a,b)=>a-b));
   results.push({name:sample.name,instanceIds,commands,slotOffsets,visiblePages});
   for(const buffer of [instRead,cmdRead,offsetRead,pixelsRead])buffer.unmap();
  }
  await device.queue.onSubmittedWorkDone();
  const features=[...device.features],minStorageBufferOffsetAlignment=device.limits.minStorageBufferOffsetAlignment;device.destroy();
  return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description},features,minStorageBufferOffsetAlignment,results,directPage,errors};
 },{shader:DRAW_SHADER,visShader:VIS_SHADER,cases,cap,maxVertexCount,pageStride:PAGE_INFO_STRIDE});
 Object.assign(report,result);
 assert.ok(!result.unavailable,result.unavailable);
 assert.deepEqual(result.compilationErrors??[],[]);
 assert.deepEqual(result.errors,[]);
 assert.ok(!result.features.includes('indirect-first-instance'));
 for(let i=0;i<cases.length;i++){
  const actual=result.results[i],oracle=expected[i];
  assert.deepEqual(actual.instanceIds,[...oracle.instances],`${actual.name}: GPU instance permutation`);
  assert.deepEqual(actual.commands,[...indirectForDraw(oracle)],`${actual.name}: indirect commands`);
  for(let slot=0;slot<6;slot++){
   const pages=oracle.overflow?[]:selectedItems(cases[i]).filter(item=>item.rest*3+item.bin===slot).map(item=>item.pageIndex).sort((a,b)=>a-b);
   assert.deepEqual(actual.visiblePages[slot],pages,`${actual.name}: visibility slot ${slot} must consume GPU scatter`);
   if(!oracle.overflow)assert.equal(actual.slotOffsets[slot],oracle.indirect[slot*4+3],`${actual.name}: GPU storage slot start ${slot}`);
  }
  assert.deepEqual(actual.visiblePages[6],[result.directPage],`${actual.name}: direct draw keeps canonical instance index`);
 }
 assert.ok(result.results[0].slotOffsets.some(offset=>offset*4%result.minStorageBufferOffsetAlignment!==0),'exercise slot starts that cannot be storage binding offsets');
 report.status='passed';
 console.log(JSON.stringify({status:report.status,adapter:result.adapter,features:result.features,cases:result.results.map(sample=>({name:sample.name,slotCounts:sample.visiblePages.slice(0,6).map(pages=>pages.length)}))}));
}catch(error){report.status='failed';report.failure=String(error);throw error;}
finally{
 report.finishedAt=new Date().toISOString();
 await writeFile(process.env.DRAW_RESULT??'/private/tmp/webgpu-draw-result.json',JSON.stringify(report,null,2));
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
