import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import ts from 'typescript';
import {SELECTION_SHADER} from '../packages/sdk-browser/gpuSelection.ts';
import {DRAW_SHADER} from '../packages/sdk-browser/gpuDraw.ts';

const labRoot=process.env.LAB_ROOT??resolve('../render-tech-lab');
const {chromium}=createRequire(resolve(labRoot,'package.json'))('playwright');
const root=resolve('.'),sources=new Map();
// Serve the production TypeScript modules so the real host scheduling and WGSL run together.
const server=createServer(async(request,response)=>{
 try{
  const pathname=new URL(request.url,'http://localhost').pathname;
  if(pathname==='/'){
   response.writeHead(200,{'content-type':'text/html'});
   response.end('<!doctype html><title>WebGeometry resident GPU cut</title><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>');return;
  }
  const file=resolve(root,'.'+decodeURIComponent(pathname));
  if(!file.startsWith(root+sep)){response.writeHead(403);response.end();return;}
  if(!sources.has(file)){
   const source=await readFile(file,'utf8');
   sources.set(file,file.endsWith('.ts')?ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText:source);
  }
  response.writeHead(200,{'content-type':'text/javascript'});response.end(sources.get(file));
 }catch(error){response.writeHead(404);response.end(String(error));}
});
await new Promise((ready,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',ready);});
const address=server.address();if(!address||typeof address==='string')throw Error('HTTP listener unavailable');
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={startedAt:new Date().toISOString(),shaders:{selection:createHash('sha256').update(SELECTION_SHADER).digest('hex'),draw:createHash('sha256').update(DRAW_SHADER).digest('hex')}};
try{
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${address.port}/`);
 const result=await page.evaluate(async()=>{
  const THREE=await import('three');
  const {createGpuSelection,packSelectionForest,cameraSelectionUniforms}=await import('/packages/sdk-browser/gpuSelection.ts');
  const {createGpuDraw}=await import('/packages/sdk-browser/gpuDraw.ts');
  const {webgpuPagesBackend}=await import('/packages/sdk-browser/webgpuPages.ts');
  const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {unavailable:'No WebGPU adapter'};
  const device=await adapter.requestDevice(),errors=[];
  device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
  let releaseReadbacks,mapRequests=0,captureCopies=0;
  const gate=new Promise(resolve=>{releaseReadbacks=resolve;}),readbacks=new Set();
  // Hold only delivery of actual GPU readbacks. GPU computation/submission remains native.
  const selectionDevice=new Proxy(device,{get(target,key){
   if(key==='createBuffer')return descriptor=>{
    const buffer=target.createBuffer(descriptor);
    if(descriptor.usage&GPUBufferUsage.MAP_READ){
     readbacks.add(buffer);const map=buffer.mapAsync.bind(buffer);
     Object.defineProperty(buffer,'mapAsync',{value:async(...args)=>{mapRequests++;await map(...args);await gate;}});
    }
    return buffer;
   };
   if(key==='createCommandEncoder')return descriptor=>{
    const encoder=target.createCommandEncoder(descriptor),copy=encoder.copyBufferToBuffer.bind(encoder);
    Object.defineProperty(encoder,'copyBufferToBuffer',{value:(...args)=>{if(readbacks.has(args[2]))captureCopies++;copy(...args);}});
    return encoder;
   };
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const tree={min:[-1,-1,0],max:[1,1,0],errorObject:.01,coarsePages:[2],children:[
   {min:[-1,-1,0],max:[0,1,0],page:0},{min:[0,-1,0],max:[1,1,0],page:1},
  ]};
  const forest=packSelectionForest([{tree,world:new THREE.Matrix4(),pages:[{url:'fine-left'},{url:'fine-right'},{url:'coarse-cover'}]}]);
  const selection=await createGpuSelection(selectionDevice,forest,{residentCut:true});
  if(!selection)throw Error('Production resident GPU selection failed to initialize');
  const draw=await createGpuDraw(device,3);if(!draw)throw Error('Production GPU draw failed to initialize');
  const camera=new THREE.PerspectiveCamera(55,1,.1,100);
  const items=[2,0,1].map(id=>({pageIndex:50+id,bin:id,rest:0,selectionIndex:id}));
  const readback=device.createBuffer({size:120,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const cases=[
   {name:'partial detail keeps the complete coarse cover',resident:[1,0,1],expected:[2]},
   {name:'complete detail replaces coarse at the same camera',resident:[1,1,1],expected:[0,1]},
   {name:'moving camera rejects pages while both readback slots are busy',resident:[1,1,1],away:true,expected:[]},
   {name:'returning camera restores current detail while readback remains busy',resident:[1,1,1],z:6,expected:[0,1]},
   {name:'evicting detail restores complete coarse coverage',resident:[1,0,1],expected:[2]},
   {name:'incomplete root without coarse emits no partial drawing',resident:[1,0,0],expected:[]},
   {name:'coarse LOD request selects resident coarse',resident:[1,1,1],pixelError:1000,expected:[2]},
  ];
  const results=[];
  for(const sample of cases){
   camera.position.set(0,0,sample.z??5);camera.lookAt(0,0,sample.away?10:0);camera.updateMatrixWorld();
   selection.updateResidency(new Uint32Array(sample.resident));
   selection.dispatch(cameraSelectionUniforms(camera,sample.pixelError??0,[256,256]));
   const encoder=device.createCommandEncoder();draw.encode(encoder,items,3,selection);
   encoder.copyBufferToBuffer(draw.indirectBuffer,0,readback,0,96);
   encoder.copyBufferToBuffer(draw.instanceBuffer,0,readback,96,12);
   encoder.copyBufferToBuffer(selection.maskBuffer,selection.maskOffset*4,readback,108,12);
   device.queue.submit([encoder.finish()]);await readback.mapAsync(GPUMapMode.READ);
   const words=new Uint32Array(readback.getMappedRange()),commands=[...words.subarray(0,24)];
   const count=commands.reduce((sum,word,i)=>sum+(i%4===1?word:0),0);
   const instanceIds=[...words.subarray(24,24+count)],mask=[...words.subarray(27,30)];readback.unmap();
   results.push({name:sample.name,expected:sample.expected,instanceIds,mask,commands,mapRequests,captureCopies,peek:selection.peek()});
  }
  releaseReadbacks();await selection.flush();
  // Once slots are available, diagnostics must also catch up to a new current cut.
  camera.position.set(0,0,7);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  selection.dispatch(cameraSelectionUniforms(camera,0,[256,256]));
  const finalDiagnostics=await selection.flush(),failed=selection.failed();
  await device.queue.onSubmittedWorkDone();
  const features=[...device.features];draw.dispose();selection.dispose();readback.destroy();
  const backendInstances=[];
  for(const side of [THREE.FrontSide,THREE.BackSide,THREE.DoubleSide]){
   const geometry=new THREE.PlaneGeometry(1,1),material=new THREE.MeshBasicMaterial({color:0xff0000,side});
   if(side===THREE.BackSide)geometry.rotateY(Math.PI);
   const source=new THREE.Group(),left=new THREE.Mesh(geometry,material),right=new THREE.Mesh(geometry,material);
   left.position.x=-.75;right.position.x=.75;right.scale.x=-1;source.add(left,right);source.updateMatrixWorld(true);
   const canvas=document.createElement('canvas'),width=128,height=64;
   const view=new THREE.PerspectiveCamera(55,width/height,.1,100);view.position.z=3;view.lookAt(0,0,0);view.updateMatrixWorld();
   const record={id:0,url:'shared',count:6,min:[-.5,-.5,0],max:[.5,.5,0],bytes:24,sha256:'fixture'};
   const backend=webgpuPagesBackend({source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages:[record],hierarchy:{min:record.min,max:record.max,page:0}}]},indices:new Map([['shared',new Uint32Array(geometry.index.array)]]),associations:new Map([[left,{meshes:0,primitives:0}],[right,{meshes:0,primitives:0}]]),gpuDevice:device,gpuCanvas:canvas,maxResidentPages:1,viewport:[width,height],pixelError:0});
   try{
    await backend.prepare();for(let frame=0;frame<3;frame++){backend.render(view);await backend.flush();}
    const pixels=backend.capture(),halves=[0,0];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(pixels[i]>100&&pixels[i+1]<50&&pixels[i+2]<50)halves[x<width/2?0:1]++;}
    backendInstances.push({side,halves,gpuDriven:backend.capabilities.gpuDriven,selectedPageIds:backend.selectedPageIds(),metrics:backend.metrics()});
   }finally{backend.dispose();geometry.dispose();material.dispose();}
  }
  await device.queue.onSubmittedWorkDone();device.destroy();
  return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description},features,results,finalDiagnostics,backendInstances,failed,errors};
 });
 Object.assign(report,result);assert.ok(!result.unavailable,result.unavailable);assert.deepEqual(result.errors,[]);
 assert.ok(!result.features.includes('indirect-first-instance'));assert.equal(result.failed,false);
 for(let i=0;i<result.results.length;i++){
  const sample=result.results[i],mask=Array.from({length:3},(_,id)=>sample.expected.includes(id)?1:0);
  assert.deepEqual(sample.mask,mask,`${sample.name}: GPU resident mask`);
  assert.deepEqual(sample.instanceIds,sample.expected.map(id=>50+id),`${sample.name}: draw consumes current GPU mask`);
  assert.deepEqual(sample.commands.filter((_,i)=>i%4===1),[...mask,0,0,0],`${sample.name}: exact indirect instance counts`);
  assert.deepEqual(sample.commands.filter((_,i)=>i%4===3),Array(6).fill(0),`${sample.name}: no optional firstInstance feature`);
  assert.equal(sample.peek,null,`${sample.name}: proof cannot rely on CPU-delivered selection results`);
  assert.equal(sample.mapRequests,1,`${sample.name}: first real readback remains held`);
  assert.equal(sample.captureCopies,i===0?2:4,`${sample.name}: both readback slots stay busy after the second frame`);
 }
 assert.deepEqual(result.finalDiagnostics?.drawablePageIds,[0,1]);assert.equal(result.finalDiagnostics?.complete,true);
 for(const sample of result.backendInstances){
  assert.equal(sample.gpuDriven,true,`side ${sample.side}: actual backend must use GPU selection and indirect draw`);
  assert.deepEqual(sample.selectedPageIds,['shared','shared'],`side ${sample.side}: shared page keeps two instance identities`);
  assert.ok(sample.halves[0]>0,`side ${sample.side}: positive determinant instance must be visible`);
  assert.equal(sample.halves[1],sample.halves[0],`side ${sample.side}: mirrored shared-page instance must retain its facing`);
 }
 report.status='passed';console.log(JSON.stringify({status:report.status,adapter:result.adapter,cases:result.results.map(sample=>({name:sample.name,mask:sample.mask,drawnPages:sample.instanceIds})),finalDiagnostics:result.finalDiagnostics}));
}catch(error){report.status='failed';report.failure=String(error);throw error;}
finally{
 report.finishedAt=new Date().toISOString();await writeFile(process.env.SELECTION_RESULT??'/private/tmp/webgpu-selection-result.json',JSON.stringify(report,null,2));
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
