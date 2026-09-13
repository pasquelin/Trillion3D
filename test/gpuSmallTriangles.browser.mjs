import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const labRoot=process.env.LAB_ROOT??resolve('../render-tech-lab');
const {chromium}=createRequire(resolve(labRoot,'package.json'))('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();
 await page.goto(process.env.WG_URL??'http://127.0.0.1:5177/test/browser-test.html');
 const result=await page.evaluate(async()=>{
  const {createGpuSmallTriangles}=await import('/packages/sdk-browser/gpuSmallTriangles.ts');
  const {VIS_SHADER}=await import('/packages/sdk-browser/visibilityBuffer.ts');
  const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw new Error('WEBGPU_ADAPTER_UNAVAILABLE');
  const device=await adapter.requestDevice();const errors=[];device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
  const module=device.createShaderModule({code:VIS_SHADER});const compilation=await module.getCompilationInfo();
  const shaderErrors=compilation.messages.filter(message=>message.type==='error').map(message=>message.message);
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;
  const write=(values,size=values.byteLength)=>{const buffer=device.createBuffer({size:Math.max(4,size),usage:storage});device.queue.writeBuffer(buffer,0,values);return buffer;};
  const indices=write(new Uint32Array([0,1,2]));
  const positions=write(new Float32Array([-.1,-.1,.5,.1,-.1,.5,0,.1,.5]));
  const uvs=write(new Float32Array(6));
  const flags=write(new Uint32Array([0]));
  const pageData=new ArrayBuffer(2*256),f=new Float32Array(pageData),u=new Uint32Array(pageData);
  for(let page=0;page<2;page++){
   const base=page*64;
   f.set([1,0,0,0,0,1,0,0,0,0,1,0,0,0,page?-.25:0,1],base);
   f[base+19]=1;u[base+23]=2;u[base+25]=3;u[base+27]=(page+1)<<16;f[base+28]=1;f[base+29]=1;u[base+31]=0xffffffff;
   // Packed selection IDs deliberately differ from table rows and mask offsets.
   u[base+47]=page?1:5;
  }
  const pages=write(new Uint8Array(pageData));
  const uniformData=new Float32Array(24),uniformWords=new Uint32Array(uniformData.buffer);
  uniformData.set([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);uniformData[16]=32;uniformData[17]=32;uniformData[18]=7;
  const uniform=device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const maskOffset=3,maskData=new Uint32Array(maskOffset+6),mask=write(maskData);
  const maps=device.createTexture({size:{width:1,height:1,depthOrArrayLayers:2},format:'rgba8unorm-srgb',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  device.queue.writeTexture({texture:maps,origin:[0,0,0]},new Uint8Array([255,255,255,255]),{bytesPerRow:4},[1,1]);
  const ids=device.createTexture({size:[32,32],format:'r32uint',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const depth=device.createTexture({size:[32,32],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  device.pushErrorScope('validation');
  const raster=createGpuSmallTriangles(device,32,32);
  const row=256,readback=device.createBuffer({size:row*32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const depthReadback=device.createBuffer({size:row*32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const samples=[];
  for(const sample of [
   {name:'selection disabled',pageRows:1,enabled:false,fine:false,coarse:false,shift:0},
   {name:'resident coarse rejected',pageRows:2,enabled:true,fine:true,coarse:false,shift:0},
   {name:'resident fine rejected',pageRows:2,enabled:true,fine:false,coarse:true,shift:0},
   {name:'all resident pages rejected',pageRows:2,enabled:true,fine:false,coarse:false,shift:0},
   {name:'moving selection returns to fine',pageRows:2,enabled:true,fine:true,coarse:false,shift:.25},
  ]){
   maskData.fill(1);maskData[maskOffset+5]=Number(sample.fine);maskData[maskOffset+1]=Number(sample.coarse);
   device.queue.writeBuffer(mask,0,maskData);
   uniformData[12]=sample.shift;uniformWords[22]=maskOffset;uniformWords[23]=Number(sample.enabled);
   device.queue.writeBuffer(uniform,0,uniformData);
   const encoder=device.createCommandEncoder();
   const clear=encoder.beginRenderPass({colorAttachments:[{view:ids.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});clear.end();
   raster.encode(encoder,{indices,positions,pages,hizFlags:flags,uniform,uvs,maps:maps.createView({dimension:'2d-array'}),sampler:device.createSampler(),pageRows:sample.pageRows,maxTriangles:1,idsView:ids.createView(),depthView:depth.createView(),selection:sample.enabled?{maskBuffer:mask,maskOffset}:undefined});
   encoder.copyTextureToBuffer({texture:ids},{buffer:readback,bytesPerRow:row},[32,32]);
   encoder.copyTextureToBuffer({texture:depth},{buffer:depthReadback,bytesPerRow:row},[32,32]);
   device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();
   await Promise.all([readback.mapAsync(GPUMapMode.READ),depthReadback.mapAsync(GPUMapMode.READ)]);
   const idsData=new DataView(readback.getMappedRange()),depthData=new DataView(depthReadback.getMappedRange());
   const pixel=(x,y)=>idsData.getUint32(y*row+x*4,true),x=16+sample.shift*16;
   samples.push({name:sample.name,centerId:pixel(x,16),outerId:pixel(0,0),oldCenterId:pixel(16,16),centerDepth:depthData.getFloat32(16*row+x*4,true)});
   readback.unmap();depthReadback.unmap();
  }
  const validation=await device.popErrorScope();
  const output={shaderErrors,validation:validation?.message??null,errors,samples,adapter:adapter.info};
  raster.dispose();device.destroy();return output;
 });
 console.log(JSON.stringify(result,null,2));
 assert.deepEqual(result.shaderErrors,[]);assert.equal(result.validation,null);assert.deepEqual(result.errors,[]);
 const expected=[{id:1<<16,depth:.5},{id:1<<16,depth:.5},{id:2<<16,depth:.25},{id:0,depth:1},{id:1<<16,depth:.5}];
 for(let i=0;i<expected.length;i++){
  const sample=result.samples[i];assert.equal(sample.centerId,expected[i].id,sample.name);assert.equal(sample.outerId,0,sample.name);assert.ok(Math.abs(sample.centerDepth-expected[i].depth)<1e-4,sample.name);
 }
 assert.equal(result.samples[4].oldCenterId,0,'current camera matrix replaces the previous raster location');
}finally{await browser.close();}
