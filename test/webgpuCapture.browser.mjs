import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Diagnostic execution on the Lab's real engine/assets/path; no performance verdict.
const labRoot=process.env.LAB_ROOT??resolve('../render-tech-lab');
const {chromium}=createRequire(resolve(labRoot,'package.json'))('playwright');
const out=resolve('benchmark-runs/webgpu-capture',process.argv[2]??new Date().toISOString().replaceAll(':','-'));
await mkdir(out,{recursive:true});
const hashes={};for(const name of ['index','webgpuPages','pageSelection','gpuSelection','awaitBackendPages','streamingPages','gpuPages','gpuPresentation','visibilityBuffer','deferredLighting','surfaceBuffer','sceneLighting','gpuTiming','gpuHiz','gpuDraw'])hashes[name]=createHash('sha256').update(await readFile(resolve('dist/sdk-browser',name+'.js'))).digest('hex');
const pageBudget=Number(process.env.GPU_PAGE_SLOTS??100000);
assert.ok(Number.isSafeInteger(pageBudget)&&pageBudget>0);
const stableCaptures=process.env.STABLE_CAPTURE==='1',unculledControl=process.env.UNCULLED_CONTROL==='1';
const result={startedAt:new Date().toISOString(),purpose:'capture-regression-only',pageBudget,hashes,stableCaptures,unculledControl,errors:[],events:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1400,height:1100}});
 if(unculledControl)await page.route('**/dist/sdk-browser/webgpuPages.js*',async route=>{
  const response=await route.fetch(),original=await response.text();
  const condition='item.bounds && !blendFrustum.intersectsBox(item.bounds)';
  assert.ok(original.includes(condition),'control must disable exactly the transparent frustum condition');
  const body=original.replace(condition,'false /* diagnostic unculled control */');
  result.controlOverrideSha256=createHash('sha256').update(body).digest('hex');
  await writeFile(resolve(out,'webgpuPages.control.js'),body);
  await route.fulfill({response,body});
 });
 page.on('pageerror',error=>result.errors.push(error.message));
 await page.exposeFunction('captureProgress',message=>console.log(message));
 await page.exposeFunction('saveCapture',async(segment,bytes)=>writeFile(resolve(out,`segment-${segment}.rgba`),Buffer.from(bytes,'base64')));
 await page.goto((process.env.LAB_URL??'http://localhost:5174')+'/?test=15-virtualized-integration');
 Object.assign(result,await page.evaluate(async({sdkUrl,stableCaptures,pageBudget})=>{
  const THREE=await import('/.vite/deps/three.js');
  const {benchEngine}=await import('/15-virtualized-integration/implementation/engines.ts');
  const {createExplorer}=await import(sdkUrl);
  const {urbanPath,framesPerSegment,warmupFrames,runAaControl}=await import('/src/lab/modelCampaign.ts');
  const factory=benchEngine('webgpu-page-raster').factory,events=[],gpuErrors=[];
  const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No WebGPU adapter');
  const gpu={vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description};
  const device=await adapter.requestDevice();device.addEventListener('uncapturederror',event=>gpuErrors.push(event.error.message));
  const geometry=new THREE.PlaneGeometry(2,2),material=new THREE.MeshBasicMaterial({color:0xff0000});
  const mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);source.updateMatrixWorld(true);
  const canvas=document.createElement('canvas');document.body.append(canvas);
  const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=3;camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const pageInfo={id:0,url:'0',count:6,min:[-1,-1,0],max:[1,1,0],bytes:24,sha256:'fixture'};
  const backend=factory({source,metadata:{primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages:[pageInfo]}]},indices:new Map([['0',new Uint32Array(geometry.index.array)]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),gpuDevice:device,gpuCanvas:canvas,maxResidentPages:1,viewport:[64,64],onDiagnostic:event=>events.push({stage:'fixture',...event})});
  let overlaps=0;
  const createBuffer=device.createBuffer.bind(device);
  device.createBuffer=descriptor=>{
   const buffer=createBuffer(descriptor);
   if(descriptor.label==='WG explicit capture'){
    const map=buffer.mapAsync.bind(buffer);
    buffer.mapAsync=async(...args)=>{await map(...args);overlaps++;backend.syncResident();};
   }
   return buffer;
  };
  try{
   await backend.prepare();for(let frame=0;frame<4;frame++){backend.render(camera);await backend.flush();}
   const pixels=backend.capture();
   if(!overlaps||!events.some(event=>event.phase==='capture-streaming-deferred'))throw Error('Streaming/readback overlap not exercised');
   if(pixels.length!==64*64*4||!pixels.some((v,i)=>i%4===0&&v>100))throw Error('Invalid GPU fixture capture');
   // Same complete plane, split into two streamed detail pages and one pinned fallback.
   const arrays=new Map([['fine0',new Uint32Array(geometry.index.array.slice(0,3))],['fine1',new Uint32Array(geometry.index.array.slice(3))],['coarse',new Uint32Array(geometry.index.array)]]);
   const pages=[{...pageInfo,id:0,url:'fine0',count:3,bytes:12},{...pageInfo,id:1,url:'fine1',count:3,bytes:12},{...pageInfo,id:2,url:'coarse',role:'coarse'}];
   const metadata={primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages}]};
   const coverage=[];
   for(const slots of [3,2]){
    const surface=document.createElement('canvas');document.body.append(surface);
    const streamed=factory({source,metadata,indices:new Map(),readPage:async url=>arrays.get(url),associations:new Map([[mesh,{meshes:0,primitives:0}]]),gpuDevice:device,gpuCanvas:surface,maxResidentPages:slots,viewport:[64,64],onDiagnostic:event=>events.push({stage:'coverage-fixture',...event})});
    try{
     await streamed.prepare();streamed.render(camera);await streamed.flush();const expected=streamed.capture().slice();
     for(const urls of [['fine0'],['fine1']]){
      for(const url of urls)streamed.acceptPage(url,arrays.get(url));streamed.syncResident();await streamed.flush();streamed.render(camera);await streamed.flush();
      const observed=streamed.capture();let differences=0;for(let i=0;i<expected.length;i++)if(expected[i]!==observed[i])differences++;
      if(differences)throw Error('GPU coverage changed with partial residency: '+differences);
      const ids=streamed.selectedPageIds().sort();
      const wanted=slots===3&&urls[0]==='fine1'?['fine0','fine1']:['coarse'];
      if(JSON.stringify(ids)!==JSON.stringify(wanted))throw Error('Unexpected GPU coverage cut: '+JSON.stringify(ids));
      coverage.push({slots,arrived:urls,ids,differences,metrics:streamed.metrics()});
     }
    }finally{streamed.dispose();surface.remove();}
   }
   events.push({stage:'coverage-fixture',phase:'coverage-proof',context:{version:1,checks:coverage}});
   await device.queue.onSubmittedWorkDone();
  }finally{backend.dispose();device.destroy();geometry.dispose();material.dispose();canvas.remove();}
  await window.captureProgress('Real GPU capture overlap passed');

  const modelCanvas=document.createElement('canvas');document.body.append(modelCanvas);
  const width=1246,height=1000,captures=[],samples=[];
  const explorer=await createExplorer(modelCanvas,{manifestUrl:'/benchmark-assets/emerald-square-derived/native/full/manifest.json',scope:'full',width,height,pixelError:1,lodQuality:'high',maxResidentPages:pageBudget,preload:'visible',backends:[factory],clearColor:0x2a303c,onDiagnostic:event=>events.push({stage:'emerald',...event})});
  try{
   const path=urbanPath(explorer.bounds),checkpoints=path.filter((_,i)=>i%framesPerSegment===0);
   for(const step of checkpoints){explorer.setPose(step.pose);await explorer.awaitPages();}
   const aa=await runAaControl(explorer,explorer.backend,checkpoints);
   if(aa.length!==10||aa.some(check=>check.differentPixels))throw Error('A/A failed: '+JSON.stringify(aa));
   const raf=()=>new Promise(resolve=>requestAnimationFrame(resolve));
   for(let i=0;i<warmupFrames;i++){await raf();explorer.render(path[0].pose);}
   for(let i=0;i<path.length;i++){
    const step=path[i];
    if(i%framesPerSegment===0){explorer.setPose(step.pose);await explorer.awaitPages();await explorer.flush();}
    await raf();samples.push({...explorer.render(step.pose),segment:step.segment});
    if(i%framesPerSegment===0){
     if(stableCaptures)for(let settle=0;settle<4;settle++){explorer.setPose(step.pose);await explorer.awaitPages();explorer.render(step.pose);await explorer.flush();}
     await explorer.flush();const pixels=explorer.capture();
     if(pixels.length!==width*height*4)throw Error('Invalid model capture length');
     let foreground=0;for(let p=0;p<pixels.length;p+=4)if(pixels[p]!==42||pixels[p+1]!==48||pixels[p+2]!==60)foreground++;
     if(foreground<100)throw Error('Empty model capture at segment '+step.segment);
     let binary='';for(let offset=0;offset<pixels.length;offset+=8192)binary+=String.fromCharCode(...pixels.subarray(offset,offset+8192));
     await window.saveCapture(step.segment,btoa(binary));
     captures.push({segment:step.segment,foreground,pose:step.pose,metrics:samples.at(-1)});
     await window.captureProgress('Emerald capture '+captures.length+'/10');
    }
   }
   await explorer.flush();
   return {gpu,gpuErrors,events,overlaps,aa,captures,samples,frames:path.length,resolution:[width,height],sourceKey:explorer.metadata.key,fallbackReason:explorer.fallbackReason,userAgent:navigator.userAgent};
  }finally{explorer.dispose();modelCanvas.remove();}
 },{sdkUrl:'/@fs'+resolve('dist/sdk-browser/index.js'),stableCaptures,pageBudget}));
 if(unculledControl)assert.ok(result.controlOverrideSha256,'control override was not served');
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.gpuErrors,[]);
 assert.ok(!result.events.some(event=>/failed|uncaptured-error|device-lost/.test(event.phase)));
 assert.ok(result.samples.every(sample=>sample.coverageReady===true&&!sample.streamingError),'all Emerald frames need complete coverage without a loading failure');
 if(pageBudget===100000)assert.ok(result.samples.every(sample=>!sample.coverageBudgetLimited));
 else assert.ok(result.samples.some(sample=>sample.coverageBudgetLimited),'reduced budget must exercise detail admission');
 assert.equal(result.frames,600);assert.equal(result.captures.length,10);assert.ok(!result.fallbackReason);
 const status=result.events.find(event=>event.stage==='emerald'&&event.phase==='gpu-timing-status');
 assert.ok(status,'timing availability must be reported');
 if(status.context.available){
  const timings=result.events.filter(event=>event.stage==='emerald'&&event.phase==='gpu-timing');
  assert.ok(timings.length>=6,'real timestamp samples required');
  assert.ok(!result.events.some(event=>event.phase==='gpu-timing-unavailable'),'timestamp readback failed');
  assert.ok(timings.every(event=>event.context.passes.every(pass=>pass.gpuMs===null?pass.reason==='invalid-timestamps':Number.isFinite(pass.gpuMs)&&pass.gpuMs>=0)));
  assert.ok(timings.some(event=>event.context.sumPassMs!==null),'at least one complete GPU sample required');
  for(const label of ['WG visibility primary','WG material surfaces v1','WG deferred lighting','WG transparents','WG HDR composition + present'])assert.ok(timings.some(event=>event.context.passes.some(pass=>pass.name===label&&pass.gpuMs!==null)),label+' valid timestamp missing');
  assert.ok(timings.every(event=>!event.context.passes.some(pass=>pass.name==='WG direct present')),'normal rendering must not copy the composed image in a second presentation pass');
  console.log('PASS: '+timings.length+' real GPU pass timing samples');
 }
 const cpuSamples=result.events.filter(event=>event.stage==='emerald').flatMap(event=>event.phase==='cpu-timing'?[event.context]:event.phase==='frame'&&event.context?.cpu?[event.context.cpu]:[]);
 assert.ok(cpuSamples.length,'CPU stages required in trace frames or summary timing events');
 for(const sample of cpuSamples)for(const field of ['totalMs','lightsMs','selectionMs','residencyScheduleAndTargetsMs','encodeSubmitMs','transparentEncodeMs']){
  assert.ok(Number.isFinite(sample[field])&&sample[field]>=0,`CPU ${field} must be a measured nonnegative duration`);
 }
 result.status='passed';console.log('PASS: GPU overlap, 10 A/A controls, 600 Emerald frames, 10 captures');
}catch(error){result.status='failed';result.error=String(error);throw error;}
finally{result.finishedAt=new Date().toISOString();await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));await browser.close();}
