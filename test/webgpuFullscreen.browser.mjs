import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {resolve,relative,join} from 'node:path';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import os from 'node:os';

// Physical pass-cost comparison using the Lab's real Emerald assets and cameras.
// Builds are immutable directories; all SDK imports are routed to the chosen build.
const root=resolve('.'),labRoot=process.env.LAB_ROOT??resolve('../render-tech-lab');
const origin=process.env.LAB_URL??'http://localhost:5174';
assert.ok(process.env.FULLSCREEN_BEFORE_DIR,'FULLSCREEN_BEFORE_DIR must name the frozen before dist directory');
assert.ok(process.env.FULLSCREEN_AFTER_DIR,'FULLSCREEN_AFTER_DIR must name the frozen after dist directory');
const dirs={A:resolve(process.env.FULLSCREEN_BEFORE_DIR),B:resolve(process.env.FULLSCREEN_AFTER_DIR)};
const out=resolve(process.argv[2]??'benchmark-runs/fullscreen-passes/'+new Date().toISOString().replaceAll(':','-'));
const order=(process.env.FULLSCREEN_ORDER??'ABBA').split('');
assert.ok(order.length>=2&&order.every(v=>v==='A'||v==='B')&&order.includes('A')&&order.includes('B'));
const width=1246,height=1000,warmup=20,sampleFrames=60,sampleEveryFrames=6;
const manifestUrl='/benchmark-assets/emerald-square-derived/native/full/manifest.json';
const sha=data=>createHash('sha256').update(data).digest('hex');
const json=(path,value)=>writeFile(path,JSON.stringify(value,null,2));
const walk=async dir=>{const files=[];for(const entry of await readdir(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isDirectory())files.push(...await walk(p));else if(p.endsWith('.js'))files.push(p);}return files;};
const stats=values=>{const a=values.filter(v=>Number.isFinite(v)).sort((a,b)=>a-b);return a.length?{n:a.length,mean:a.reduce((a,b)=>a+b,0)/a.length,p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],min:a[0],max:a.at(-1)}:null;};
const compare=(a,b)=>{assert.equal(a.length,b.length);let differentPixels=0,maxChannelError=0;for(let p=0;p<a.length;p+=4){let changed=false;for(let c=0;c<4;c++){const d=Math.abs(a[p+c]-b[p+c]);changed ||= d!==0;maxChannelError=Math.max(maxChannelError,d);}if(changed)differentPixels++;}return {differentPixels,maxChannelError};};
await mkdir(out,{recursive:true});
const manifestText=await(await fetch(origin+manifestUrl)).text(),manifest=JSON.parse(manifestText);
const metadataUrl=new URL(manifest.url,origin+manifestUrl).href,metadataText=await(await fetch(metadataUrl)).text();
await writeFile(join(out,'manifest.json'),manifestText);await writeFile(join(out,'clusters.json'),metadataText);
const served={A:new Map(),B:new Map()},hashes={A:{},B:{}},transformedHashes={A:{},B:{}};
const dependencyUrls={};
const imports=body=>[...body.matchAll(/^import\s+(.+?)\s+from\s+(['"])([^'"]+)\2/gm)].map(m=>({binding:m[1].replaceAll(/\s+/g,' '),url:m[3]}));
for(const name of ['index','geometryPage']){
 const raw=await readFile(join(dirs.A,'sdk-browser',name+'.js'),'utf8');
 const response=await fetch(origin+'/@fs'+root+'/dist/sdk-browser/'+name+'.js');
 assert.ok(response.ok,'Lab SDK dependency resolution unavailable');
 const transformed=imports(await response.text());
 for(const item of imports(raw).filter(item=>!item.url.startsWith('.'))){
  const resolved=transformed.find(candidate=>candidate.binding===item.binding);
  assert.ok(resolved,'Vite dependency import missing: '+item.url);dependencyUrls[item.url]=resolved.url;
 }
}
for(const variant of ['A','B']){
 for(const file of await walk(dirs[variant])){
  const name=relative(dirs[variant],file).replaceAll('\\','/'),raw=await readFile(file);
  hashes[variant][name]=sha(raw);
  // Resolve only bare third-party imports through the Lab's existing Vite URLs.
  // Relative SDK imports remain under the canonical, fully frozen route.
  let body=raw.toString().replace(/(\bfrom\s*)(['"])([^'"]+)\2/g,(all,prefix,quote,specifier)=>dependencyUrls[specifier]?prefix+quote+dependencyUrls[specifier]+quote:all);
  if(name==='sdk-browser/webgpuPages.js'){
   const pattern=/sampleEveryFrames:\s*traceEnabled\s*\?\s*1\s*:\s*60/g;
   assert.equal([...body.matchAll(pattern)].length,1,'timestamp interval override must match exactly once');
   body=body.replace(pattern,'sampleEveryFrames: '+sampleEveryFrames);
  }
  served[variant].set(name,body);transformedHashes[variant][name]=sha(body);
 }
}
const changedModules=[...new Set([...Object.keys(hashes.A),...Object.keys(hashes.B)])].filter(name=>hashes.A[name]!==hashes.B[name]);
const provenance={startedAt:new Date().toISOString(),harnessSha256:sha(await readFile(new URL(import.meta.url))),root,labRoot,origin,dirs,order,hashes,transformedHashes,changedModules,dependencyUrls,
 manifestUrl,metadataUrl,manifestSha256:sha(manifestText),metadataSha256:sha(metadataText),sourceKey:manifest.key,
 labHashes:{modelCampaign:sha(await readFile(join(labRoot,'src/lab/modelCampaign.ts'))),engines:sha(await readFile(join(labRoot,'15-virtualized-integration/implementation/engines.ts')))},
 configuration:{backend:'webgpu-page-raster',width,height,pixelRatio:1,lodQuality:'high',pixelError:1,replicaCount:1,detail:'source',maxResidentPages:100000,preload:'visible',pathVersion:5,warmup,sampleFrames,sampleEveryFrames},
 protocol:{quality:'10 fixed Lab path checkpoints; settle residency; exact A/A and repeated A/B comparison of explicit RGBA capture and direct canvas; identical page cuts and geometry counters',
 timing:'20 warmup + 60 measured renders per fixed pose; requestAnimationFrame cadence; flush after each frame; no captures during measurements; identical timestamp interval override (60 to 6) in both variants, summary diagnostics',
 limits:'sum of instrumented GPU render/compute passes only; excludes selection dispatch, uploads, CPU, queue latency and presentation latency; serialized diagnostic experiment, no FPS or weak-hardware verdict'},
 host:{platform:os.platform(),arch:os.arch(),release:os.release(),cpus:os.cpus().map(v=>v.model),totalMemory:os.totalmem()}};
await json(join(out,'provenance.json'),provenance);
const {chromium}=createRequire(join(labRoot,'package.json'))('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const baselines=new Map(),controls=[],runs=[];
try{
 for(const [runIndex,variant] of order.entries()){
  const run=String(runIndex+1).padStart(2,'0')+'-'+variant;
  const context=await browser.newContext({viewport:{width:1320,height:1080},deviceScaleFactor:1});
  const page=await context.newPage(),pageErrors=[],hits=new Set();
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('console',msg=>{if(msg.type()==='error')pageErrors.push(msg.text());});
  await page.route(url=>url.origin===origin&&url.pathname==='/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>WebGeometry fullscreen pass comparison</title><style>body{margin:0}canvas{display:block}</style>'}));
  await page.route(url=>url.origin===origin&&url.pathname.includes('/dist/')&&url.pathname.endsWith('.js'),route=>{
   const name=new URL(route.request().url()).pathname.split('/dist/').at(-1),body=served[variant].get(name);
   if(body===undefined)throw Error('Unfrozen SDK module requested: '+name);hits.add(name);
   return route.fulfill({contentType:'application/javascript',body});
  });
  await page.exposeFunction('fullscreenProgress',message=>console.log(JSON.stringify({run,message,at:new Date().toISOString()})));
  await page.exposeFunction('saveFullscreenControl',async item=>{
   const pixels=Buffer.from(item.rgba,'base64'),screen=Buffer.from(item.screenRgba,'base64'),baseline=baselines.get(item.segment);
   const ab=baseline?compare(baseline.pixels,pixels):{differentPixels:0,maxChannelError:0};
   const screenAb=baseline?compare(baseline.screen,screen):{differentPixels:0,maxChannelError:0};
   const keys=['selectedTriangles','submittedTriangles','residentPages','clusters','transparentMeshes','transparentDrawCalls','transparentSubmittedTriangles','coverageReady','coverageBudgetLimited'];
   const counterDifferences=baseline?keys.filter(key=>baseline.metrics[key]!==item.metrics[key]).map(key=>({key,before:baseline.metrics[key],after:item.metrics[key]})):[];
   const cutEqual=!baseline||JSON.stringify(baseline.selectedPageIds)===JSON.stringify(item.selectedPageIds);
   const expectedDrawDelta=baseline&&baseline.variant!==variant?(variant==='B'?-1:1):0;
   const drawDelta=baseline?item.metrics.drawCalls-baseline.metrics.drawCalls:0;
   if(!baseline)baselines.set(item.segment,{variant,pixels,screen,metrics:item.metrics,selectedPageIds:item.selectedPageIds});
   const prefix=join(out,run+'-segment-'+item.segment);
   await writeFile(prefix+'.rgba',pixels);await writeFile(prefix+'.screen.rgba',screen);await writeFile(prefix+'.png',Buffer.from(item.png.split(',')[1],'base64'));
   const {rgba,screenRgba,png,...rest}=item;
   controls.push({run,variant,...rest,sha256:sha(pixels),screenSha256:sha(screen),ab,screenAb,cutEqual,counterDifferences,drawDelta,expectedDrawDelta});
   await json(join(out,'controls.json'),controls);
   assert.ok(!item.aa.differentPixels&&!item.screenAa.differentPixels&&!item.screenVsRaw.differentPixels&&!ab.differentPixels&&!screenAb.differentPixels&&cutEqual&&!counterDifferences.length,'Exact rendering gate failed: '+JSON.stringify({run,segment:item.segment,aa:item.aa,screenAa:item.screenAa,screenVsRaw:item.screenVsRaw,ab,screenAb,cutEqual,counterDifferences}));
   assert.equal(drawDelta,expectedDrawDelta,'The fused variant must remove exactly one fullscreen draw');
  });
  try{
   await page.goto(origin+'/');
   const result=await page.evaluate(async({sdkUrl,manifestUrl,width,height,warmup,sampleFrames,sampleEveryFrames})=>{
    const {createExplorer}=await import(sdkUrl);
    const {benchEngine}=await import('/15-virtualized-integration/implementation/engines.ts');
    const {urbanPath,pathVersion,framesPerSegment}=await import('/src/lab/modelCampaign.ts');
    if(pathVersion!==5||framesPerSegment!==60)throw Error('Lab camera path version changed');
    const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('WebGPU unavailable');
    const gpu={vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description};
    const events=[],measurements=[];let phase='prepare',segment=null;
    const canvas=document.createElement('canvas');document.body.append(canvas);
    const explorer=await createExplorer(canvas,{manifestUrl,scope:'full',width,height,pixelRatio:1,pixelError:1,lodQuality:'high',replicaCount:1,detail:'source',maxResidentPages:100000,preload:'visible',clearColor:0x2a303c,backends:[benchEngine('webgpu-page-raster').factory],diagnosticDetail:'summary',onDiagnostic:event=>{const record={...event,experimentPhase:phase,segment};events.push(record);if(phase==='measure'&&event.phase==='gpu-timing')measurements.push(record);}});
    const backend=explorer.backends.find(b=>b.id==='webgpu-page-raster');
    explorer.select('webgpu-page-raster');explorer.setDiagnostic('beauty');
    const path=urbanPath(explorer.bounds),checkpoints=path.filter((_,i)=>i%framesPerSegment===0),samples=[];
    const raf=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    const compare=(a,b)=>{let differentPixels=0,maxChannelError=0;for(let p=0;p<a.length;p+=4){let changed=false;for(let c=0;c<4;c++){const d=Math.abs(a[p+c]-b[p+c]);changed ||= d!==0;maxChannelError=Math.max(maxChannelError,d);}if(changed)differentPixels++;}return {differentPixels,maxChannelError};};
    const b64=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};
    const screen=()=>{const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0);const top=ctx.getImageData(0,0,width,height).data,bottom=new Uint8Array(top.length);for(let y=0;y<height;y++)bottom.set(top.subarray(y*width*4,(y+1)*width*4),(height-1-y)*width*4);return bottom;};
    const check=m=>{if(m.coverageReady!==true||m.coverageBudgetLimited||m.streamingError||explorer.fallbackReason)throw Error('Incomplete render: '+JSON.stringify(m));};
    try{
     await window.fullscreenProgress('Emerald loaded; preload 10 checkpoint cuts');
     for(const step of checkpoints){explorer.setPose(step.pose);await explorer.awaitPages();explorer.render(step.pose);await explorer.flush();}
     const status=events.find(e=>e.phase==='gpu-timing-status');
     if(!status?.context.available||status.context.sampleEveryFrames!==sampleEveryFrames)throw Error('Physical timestamps unavailable or instrumentation mismatch');
     for(const step of checkpoints){
      segment=step.segment;phase='quality';explorer.setPose(step.pose);
      let previous,previousScreen,aa,screenAa,screenVsRaw,pixels,screenPixels,screenPng,metrics,rounds=0;
      for(;rounds<10;rounds++){
       await explorer.awaitPages();metrics={...explorer.render(step.pose)};
       // WebGPU's current canvas texture expires when control returns to the
       // browser. Read the visible image synchronously in the render task.
       screenPixels=screen();screenPng=canvas.toDataURL('image/png');
       await explorer.flush();check(metrics);pixels=explorer.capture().slice();
       screenVsRaw=compare(screenPixels,pixels);
       if(screenVsRaw.differentPixels)throw Error('Visible canvas differs from persistent GPU target: '+JSON.stringify({segment,...screenVsRaw}));
       if(previous){aa=compare(previous,pixels);screenAa=compare(previousScreen,screenPixels);if(!aa.differentPixels&&!screenAa.differentPixels&&rounds>=2&&!metrics.pagesLoading)break;}
       previous=pixels;previousScreen=screenPixels;
      }
      if(!aa||aa.differentPixels||screenAa.differentPixels)throw Error('A/A instability at pose '+segment);
      await window.saveFullscreenControl({segment,pose:step.pose,metrics,selectedPageIds:backend.selectedPageIds?.()??[],rounds,aa,screenAa,screenVsRaw,rgba:b64(pixels),screenRgba:b64(screenPixels),png:screenPng});
      await window.fullscreenProgress('Pose '+(segment+1)+'/10: exact image gate passed; GPU timings');
      phase='warmup';for(let i=0;i<warmup;i++){await raf();explorer.render(step.pose);await explorer.flush();}
      phase='measure';const first=measurements.length;
      for(let i=0;i<sampleFrames;i++){await raf();const metrics={...explorer.render(step.pose)};await explorer.flush();check(metrics);samples.push({segment,index:i,...metrics});}
      const measured=measurements.slice(first),valid=measured.filter(e=>Number.isFinite(e.context.sumPassMs));
      if(valid.length<Math.floor(sampleFrames/sampleEveryFrames)*.8)throw Error('Insufficient valid physical timestamps at pose '+segment+': '+valid.length);
      phase='between';
     }
     await explorer.flush();
     if(events.some(e=>/failed|uncaptured-error|device-lost|gpu-timing-unavailable|diagnostic-loss/.test(e.phase)))throw Error('GPU or diagnostic failure');
     return {gpu,userAgent:navigator.userAgent,sourceKey:explorer.metadata.key,bounds:explorer.bounds,checkpoints,events,measurements,samples};
    }finally{explorer.dispose();canvas.remove();}
   },{sdkUrl:'/@fs'+root+'/dist/sdk-browser/index.js',manifestUrl,width,height,warmup,sampleFrames,sampleEveryFrames});
   assert.equal(pageErrors.length,0,'Browser errors: '+pageErrors.join('\n'));
   assert.ok(hits.has('sdk-browser/webgpuPages.js')&&hits.has('sdk-browser/gpuPresentation.js')&&hits.has('sdk-browser/deferredLighting.js'),'Full render chain route must be exercised');
   runs.push({run,variant,...result,pageErrors,servedModules:[...hits]});
   await json(join(out,run+'.json'),runs.at(-1));
   await json(join(out,'progress.json'),{status:'running',completed:runs.map(r=>r.run),planned:order});
   console.log(JSON.stringify({run,status:'completed',samples:result.measurements.length}));
  }finally{await context.close();}
 }
 const passCountChecks=Array.from({length:10},(_,segment)=>{
  const counts=v=>[...new Set(runs.filter(r=>r.variant===v).flatMap(r=>r.measurements.filter(e=>e.segment===segment).map(e=>e.context.passes.length)))];
  const before=counts('A'),after=counts('B');
  assert.equal(before.length,1,'Pass count must be stable at fixed before pose '+segment);assert.equal(after.length,1,'Pass count must be stable at fixed after pose '+segment);
  assert.equal(after[0],before[0]-1,'The fused variant must remove exactly one measured GPU pass at pose '+segment);
  return {segment,before:before[0],after:after[0],delta:after[0]-before[0]};
 });
 const summarize=records=>{
  const valid=records.filter(e=>Number.isFinite(e.context.sumPassMs)),names=[...new Set(records.flatMap(e=>e.context.passes.map(p=>p.name)))];
  return {totalSamples:records.length,validSamples:valid.length,invalidSamples:records.length-valid.length,sumPassMs:stats(valid.map(e=>e.context.sumPassMs)),passes:Object.fromEntries(names.map(name=>[name,stats(records.flatMap(e=>e.context.passes.filter(p=>p.name===name&&Number.isFinite(p.gpuMs)).map(p=>p.gpuMs)))]))};
 };
 const summary={status:'completed',order,controls:controls.length,allImageGatesPassed:true,changedModules,passCountChecks,
  aggregate:Object.fromEntries(['A','B'].map(v=>[v,summarize(runs.filter(r=>r.variant===v).flatMap(r=>r.measurements))])),
  poses:Array.from({length:10},(_,segment)=>({segment,...Object.fromEntries(['A','B'].map(v=>[v,summarize(runs.filter(r=>r.variant===v).flatMap(r=>r.measurements.filter(e=>e.segment===segment)))]))})),
  runs:runs.map(r=>({run:r.run,variant:r.variant,...summarize(r.measurements)})),limits:provenance.protocol.limits};
 await json(join(out,'summary.json'),summary);console.log(JSON.stringify({out,status:'completed',aggregate:summary.aggregate}));
}catch(error){await json(join(out,'failure.json'),{error:String(error),stack:error.stack,completed:runs.map(r=>r.run)});throw error;}
finally{await browser.close();}
