import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {cp,mkdir,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,extname,relative,resolve,sep} from 'node:path';
import {pipeline} from 'node:stream/promises';

// Real Emerald / Lab 15 comparison. Timed GPU passes exclude capture, uploads,
// CPU work and presentation latency; they do not establish an end-to-end FPS.
// Usage: MANIFEST_URL=/.../manifest.json node test/transparentLod.browser.mjs NAME
// SDK_DIST_DIR chooses a compiled SDK; each run copies it before loading modules.
// CAPTURE_ONLY=1 PIXEL_ERROR=0 captures the exact geometry without a timing run.
// POSES_RESULT reuses poses without claiming comparable quality/performance.
// Measured runs require EXPECTED_METADATA_SHA256. Use a private pinned manifest,
// EXPECTED_CACHE_KEY and EXPECTED_SOURCE_GLTF_SHA256 for comparisons across edits.
// EXPECTED_FORMAT_VERSION pins both pointer and metadata schema; optional
// EXPECTED_MAX_CHANNEL_ERROR enforces a visual threshold against BASELINE_RESULT.
// Repeat with identical options for the other build/cache. Optional BASELINE_RESULT
// verifies poses/configuration and compares the saved pixels after measurement.
const labRoot=resolve(process.env.LAB_ROOT??'../render-tech-lab');
const labUrl=process.env.LAB_URL??'http://localhost:5174';
const manifestUrl=process.env.MANIFEST_URL??'/benchmark-assets/emerald-square-derived/native/full/manifest.json';
const out=resolve('benchmark-runs/transparent-lod',process.argv[2]??new Date().toISOString().replaceAll(':','-'));
const sdkDistSource=resolve(process.env.SDK_DIST_DIR??'dist'),sdkDist=resolve(out,'runtime-dist');
const captureOnly=process.env.CAPTURE_ONLY==='1',pixelError=Number(process.env.PIXEL_ERROR??1);
assert.ok(Number.isFinite(pixelError)&&pixelError>=0,'PIXEL_ERROR must be finite and nonnegative');
assert.ok(captureOnly||/^[a-f0-9]{64}$/.test(process.env.EXPECTED_METADATA_SHA256??''),'Measured runs require EXPECTED_METADATA_SHA256 to identify the intended cache');
const configuration={width:1246,height:1000,pixelError,lodQuality:pixelError===0?'source':'high',maxResidentPages:100000,diagnosticDetail:'summary',warmupFrames:60,timestampSamplesPerView:captureOnly?0:60,segments:[0,3,8],clearColor:0x2a303c};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function buildHashes(dist=sdkDist){
 const hashes={};
 for(const directory of ['sdk-browser','sdk-core'])for(const name of (await readdir(resolve(dist,directory))).filter(name=>name.endsWith('.js')).sort())hashes['dist/'+directory+'/'+name]=digest(await readFile(resolve(dist,directory,name)));
 for(const name of ['15-virtualized-integration/implementation/engines.ts','src/lab/modelCampaign.ts'])hashes['lab/'+name]=digest(await readFile(resolve(labRoot,name)));
 return hashes;
}
const localFsPath=url=>{const path=decodeURIComponent(new URL(url).pathname);return path.startsWith('/@fs/')?path.slice(4):null;};
async function fetchArtifact(url){
 const local=localFsPath(url);let text;
 if(local)text=await readFile(local,'utf8');else{const response=await fetch(url);assert.ok(response.ok,`${response.status}: ${url}`);text=await response.text();}
 return {url,sha256:digest(text),json:JSON.parse(text)};
}
const {chromium}=createRequire(resolve(labRoot,'package.json'))('playwright');
await mkdir(out,{recursive:true});
const sourceHashes=await buildHashes(sdkDistSource);
await cp(sdkDistSource,sdkDist,{recursive:true,errorOnExist:true,force:false});
assert.deepEqual(await buildHashes(),sourceHashes,'SDK source changed while snapshotting');
const result={version:1,status:'running',startedAt:new Date().toISOString(),configuration,captureOnly,labRoot,labUrl,manifestUrl,sdkDistSource,sdkDist,runnerSha256:digest(await readFile(new URL(import.meta.url))),scope:captureOnly?'Visual capture only; no GPU performance measurement':'Measured GPU render passes on fixed Emerald views; no end-to-end FPS claim',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes:sourceHashes,errors:[],consoleErrors:[],httpErrors:[],requestFailures:[],views:[]};
let browser,cacheServer;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 result.browserVersion=browser.version();
 result.system=await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
 assert.ok(!/swiftshader|llvmpipe|lavapipe/i.test(JSON.stringify(result.system.gpu?.devices)),'Physical GPU required');
 result.manifest=await fetchArtifact(new URL(manifestUrl,labUrl).href);
 result.metadata=await fetchArtifact(new URL(result.manifest.json.url,result.manifest.url).href);
 const sourceGltf=await fetchArtifact(new URL('source.gltf',result.metadata.url).href);
 result.sourceGltf={url:sourceGltf.url,sha256:sourceGltf.sha256,buffers:sourceGltf.json.buffers};
 result.expectedCache={metadataSha256:process.env.EXPECTED_METADATA_SHA256??null,key:process.env.EXPECTED_CACHE_KEY??null,sourceGltfSha256:process.env.EXPECTED_SOURCE_GLTF_SHA256??null,formatVersion:process.env.EXPECTED_FORMAT_VERSION===undefined?null:Number(process.env.EXPECTED_FORMAT_VERSION)};
 if(result.expectedCache.metadataSha256)assert.equal(result.metadata.sha256,result.expectedCache.metadataSha256,'Unexpected metadata SHA: comparison cache was replaced');
 if(result.expectedCache.key)assert.equal(result.metadata.json.key,result.expectedCache.key,'Unexpected comparison cache key');
 if(result.expectedCache.sourceGltfSha256)assert.equal(sourceGltf.sha256,result.expectedCache.sourceGltfSha256,'Unexpected source glTF SHA');
 if(result.expectedCache.formatVersion!==null){assert.equal(result.manifest.json.formatVersion,result.expectedCache.formatVersion,'Unexpected manifest format');assert.equal(result.metadata.json.formatVersion,result.expectedCache.formatVersion,'Unexpected metadata format');assert.equal(result.metadata.json.schema,result.expectedCache.formatVersion,'Unexpected metadata schema');}
 await writeFile(resolve(out,'manifest.json'),JSON.stringify(result.manifest.json,null,2));
 await writeFile(resolve(out,'metadata.json'),JSON.stringify(result.metadata.json));
 // Keep provenance compact; full metadata remains available beside the report.
 result.metadata={url:result.metadata.url,sha256:result.metadata.sha256,key:result.metadata.json.key,formatVersion:result.metadata.json.formatVersion,schema:result.metadata.json.schema,compilerVersion:result.metadata.json.compilerVersion,source:result.metadata.json.source,clusterStrategy:result.metadata.json.clusterStrategy};
 const baseline=process.env.BASELINE_RESULT?JSON.parse(await readFile(process.env.BASELINE_RESULT,'utf8')):null;
 const poses=baseline??(process.env.POSES_RESULT?JSON.parse(await readFile(process.env.POSES_RESULT,'utf8')):null);
 if(baseline){
  const renderConfiguration=value=>{const {timestampSamplesPerView,...rest}=value;return rest;};
  assert.deepEqual(captureOnly?renderConfiguration(configuration):configuration,captureOnly?renderConfiguration(baseline.configuration):baseline.configuration,'Before/after configuration differs');
 }
 const page=await browser.newPage({viewport:{width:1400,height:1100}});
 // Keep the Lab UI and module imports, but isolate this measurement page from
 // development reload messages caused by concurrent edits in other tasks.
 result.viteHotReload='isolated websocket; rendering and module requests unchanged';
 await page.routeWebSocket(url=>url.host===new URL(labUrl).host&&url.searchParams.has('token'),socket=>{socket.send(JSON.stringify({type:'connected'}));});
 page.on('pageerror',error=>result.errors.push(error.message));
 page.on('crash',()=>result.errors.push('Renderer process crashed'));
 page.on('console',message=>{if(message.type()==='error')result.consoleErrors.push(message.text());});
 page.on('response',response=>{if(response.status()>=400)result.httpErrors.push({url:response.url(),status:response.status()});});
 page.on('requestfailed',request=>{const failure={url:request.url(),error:request.failure()?.errorText};result.requestFailures.push(failure);if(!(failure.error==='net::ERR_ABORTED'&&new URL(failure.url).pathname.startsWith('/api/')))result.httpErrors.push(failure);});
 // Vite's allow list need not expose report/cache directories. Serve only this
 // run's SDK snapshot and the explicitly selected cache, without changing Vite.
 const dependencies=JSON.parse(await readFile(resolve(labRoot,'.vite/deps/_metadata.json'),'utf8'));
 result.dependencyBrowserHash=dependencies.browserHash;result.servedModuleHashes={};
 await page.route('**/__wg_frozen_sdk__/**',async route=>{
  const relative=decodeURIComponent(new URL(route.request().url()).pathname).split('/__wg_frozen_sdk__/')[1];
  const file=resolve(sdkDist,relative);assert.ok(file.startsWith(sdkDist+sep)&&file.endsWith('.js'));
  const source=await readFile(file,'utf8');
  const body=source.replace(/^((?:import|export)\s+[^\n]*?\sfrom\s*)(['"])([^'"]+)\2/gm,(match,prefix,quote,specifier)=>{
   if(specifier.startsWith('.'))return match;
   const dependency=dependencies.optimized[specifier];assert.ok(dependency,`Unresolved frozen SDK dependency: ${specifier}`);
   return `${prefix}${quote}/.vite/deps/${dependency.file}?v=${dependencies.browserHash}${quote}`;
  });
  result.servedModuleHashes[relative]=digest(body);await route.fulfill({contentType:'application/javascript',body});
 });
 const localManifest=localFsPath(result.manifest.url);
 let renderManifestUrl=manifestUrl;
 if(localManifest){
  const cacheRoot=dirname(dirname(dirname(localManifest)));
  // Stream large source buffers; route.fulfill(path) would materialize and
  // base64-copy the entire Emerald buffer through the browser control channel.
  cacheServer=createServer(async(request,response)=>{
   try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const servingRoot=pathname.startsWith('/benchmark-assets/')?resolve(labRoot,'public'):cacheRoot;
    const file=resolve(servingRoot,pathname.slice(1));
    if(!file.startsWith(servingRoot+sep)){response.writeHead(403).end();return;}
    const info=await stat(file);if(!info.isFile()){response.writeHead(404).end();return;}
    const type={'.json':'application/json','.gltf':'model/gltf+json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(file)]??'application/octet-stream';
    response.writeHead(200,{'Content-Type':type,'Content-Length':info.size,'Access-Control-Allow-Origin':new URL(labUrl).origin});
    await pipeline(createReadStream(file),response);
   }catch(error){if(!response.headersSent)response.writeHead(404).end();else response.destroy(error);}
  });
  await new Promise(resolve=>cacheServer.listen(0,'127.0.0.1',resolve));
  renderManifestUrl=`http://127.0.0.1:${cacheServer.address().port}/${relative(cacheRoot,localManifest).split(sep).join('/')}`;
  result.localCacheRoot=cacheRoot;
 }
 const frozenPointer={...result.manifest.json,url:localFsPath(result.metadata.url)?new URL(relative(result.localCacheRoot,localFsPath(result.metadata.url)).split(sep).join('/'),new URL('/',renderManifestUrl)).href:result.metadata.url};
 await page.route('**/__wg_frozen_manifest__.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(frozenPointer)}));
 renderManifestUrl='/__wg_frozen_manifest__.json';result.frozenPointer=frozenPointer;
 result.renderManifestUrl=renderManifestUrl;
 await page.exposeFunction('benchmarkProgress',message=>console.log(message));
 await page.exposeFunction('saveView',async(segment,png,rgba)=>{
  await writeFile(resolve(out,`segment-${segment}.png`),Buffer.from(png.split(',')[1],'base64'));
  await writeFile(resolve(out,`segment-${segment}.rgba`),Buffer.from(rgba,'base64'));
 });
 await page.goto(labUrl+'/?test=15-virtualized-integration');
 Object.assign(result,await page.evaluate(async({sdkUrl,manifestUrl,configuration,baselinePoses,captureOnly,expectedTextures,sourceHasImages})=>{
  // Same public factory as Lab 15's webgpu-page-raster, from the frozen SDK.
  const {createExplorer,webgpuPagesBackend}=await import(sdkUrl);
  const {urbanPath,framesPerSegment,pathVersion,segmentNames}=await import('/src/lab/modelCampaign.ts');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No WebGPU adapter');
  const gpu={vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description,features:[...adapter.features]};
  if(!captureOnly&&!adapter.features.has('timestamp-query'))throw Error('Physical timestamp-query required');
  const canvas=document.createElement('canvas');document.body.append(canvas);
  let currentSegment=null,phase='prepare';const events=[],views=[];
  const explorer=await createExplorer(canvas,{...configuration,manifestUrl,scope:'full',preload:'visible',backends:[webgpuPagesBackend],onDiagnostic:event=>events.push({segment:currentSegment,measurementPhase:phase,...event})});
  const backend=explorer.backends.find(candidate=>candidate.id==='webgpu-page-raster');
  await explorer.flush();
  const textures=events.find(event=>event.phase==='material-textures-ready')?.context;
  if(sourceHasImages&&(!textures||textures.color.count+textures.data.count===0))throw Error('INVALID_MATERIALS: source images were not loaded');
  if(expectedTextures&&JSON.stringify([textures?.color,textures?.data])!==JSON.stringify([expectedTextures.color,expectedTextures.data]))throw Error('INVALID_MATERIALS: prepared texture counts/formats differ from baseline');
  const raf=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  const measured=()=>events.filter(event=>event.segment===currentSegment&&event.measurementPhase==='measure'&&event.phase==='gpu-timing');
  const validTimings=()=>measured().filter(event=>event.context.passes?.some(pass=>pass.name==='WG transparents'&&Number.isFinite(pass.gpuMs)));
  const distribution=values=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return sorted.length?{count:sorted.length,min:sorted[0],p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)}:null;};
  try{
   const path=urbanPath(explorer.bounds);
   for(const segment of configuration.segments){
    currentSegment=segment;phase='settle';const pose=baselinePoses?.[segment]??path[segment*framesPerSegment].pose;
    explorer.setPose(pose);await explorer.awaitPages();await explorer.flush();
    for(let settle=0;settle<6;settle++){explorer.render(pose);await explorer.awaitPages();await explorer.flush();}
    phase='warmup';for(let frame=0;frame<configuration.warmupFrames;frame++){await raf();explorer.render(pose);}
    await explorer.flush();
    const timingStatus=events.find(event=>event.phase==='gpu-timing-status');
    if(!captureOnly&&(!timingStatus?.context.available||timingStatus.context.sampleEveryFrames!==60))throw Error('Expected summary GPU timing every 60 frames');
    await window.benchmarkProgress(`Segment ${segment}: ${captureOnly?'capture only':`measuring ${configuration.timestampSamplesPerView} GPU samples`}`);
    phase='measure';const frames=[];const startedAt=performance.now();
    while(validTimings().length<configuration.timestampSamplesPerView){
     if(frames.length>=configuration.timestampSamplesPerView*120)throw Error('GPU timing sampling deadline exceeded');
     for(let i=0;i<60;i++){await raf();const metrics={...explorer.render(pose)};if(metrics.coverageReady!==true||metrics.streamingError||metrics.coverageBudgetLimited)throw Error('Incomplete or budget-limited coverage during measurement');frames.push(metrics);}
     await explorer.flush();
    }
    const elapsedMs=performance.now()-startedAt;
    phase='capture';const captureMetrics={...explorer.render(pose)};await explorer.flush();const a=explorer.capture().slice();
    if(captureMetrics.coverageReady!==true||captureMetrics.streamingError||captureMetrics.coverageBudgetLimited)throw Error('Incomplete or budget-limited capture coverage');
    explorer.render(pose);await explorer.flush();const b=explorer.capture().slice();
    let differentPixels=0,maxChannelError=0;for(let i=0;i<a.length;i+=4){let changed=false;for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);if(d)changed=true;maxChannelError=Math.max(d,maxChannelError);}if(changed)differentPixels++;}
    if(differentPixels)throw Error(`A/A unstable at segment ${segment}: ${differentPixels} pixels`);
    const pixels=document.createElement('canvas');pixels.width=configuration.width;pixels.height=configuration.height;
    const ctx=pixels.getContext('2d'),data=ctx.createImageData(pixels.width,pixels.height),row=pixels.width*4;
    for(let y=0;y<pixels.height;y++)data.data.set(a.subarray(y*row,(y+1)*row),(pixels.height-1-y)*row);ctx.putImageData(data,0,0);
    let binary='';for(let i=0;i<a.length;i+=8192)binary+=String.fromCharCode(...a.subarray(i,i+8192));await window.saveView(segment,pixels.toDataURL(),btoa(binary));
    const timings=validTimings().map(event=>event.context);
    const counts=timings.length?timings:[captureMetrics];
    const grass=explorer.metadata.primitives.find(primitive=>primitive.mesh===60&&primitive.primitive===0),selectedUrls=new Set(backend.selectedPageIds?.()??[]);
    const grassSubmittedTriangles=grass?.pages?.length?grass.pages.reduce((sum,page)=>sum+(selectedUrls.has(page.url)?page.count/3*2:0),0):null;
    const view={segment,name:segmentNames[segment],pose,frames,captureMetrics,elapsedMs,timings,grassSubmittedTriangles,grassCountScope:'Selected resident page indices times two passes; Emerald mesh 60 primitive 0 has one source instance; null for unpaged source',aa:{differentPixels,maxChannelError},summary:{transparentGpuMs:distribution(timings.flatMap(sample=>sample.passes.filter(pass=>pass.name==='WG transparents').map(pass=>pass.gpuMs))),sumRenderPassGpuMs:distribution(timings.map(sample=>sample.sumPassMs)),transparentSubmittedTriangles:distribution(counts.map(sample=>sample.transparentSubmittedTriangles)),transparentDrawCalls:distribution(counts.map(sample=>sample.transparentDrawCalls)),totalSubmittedTriangles:distribution((frames.length?frames:[captureMetrics]).map(frame=>frame.submittedTriangles))}};
    views.push(view);await window.benchmarkProgress(JSON.stringify({segment,frames:frames.length,summary:view.summary}));
   }
   await explorer.flush();
   return {gpu,events,views,textures:{color:textures.color,data:textures.data},pathVersion,sourceKey:explorer.metadata.key,bounds:{min:explorer.bounds.min.toArray(),max:explorer.bounds.max.toArray()},fallbackReason:explorer.fallbackReason,userAgent:navigator.userAgent};
  }finally{explorer.dispose();canvas.remove();}
 },{sdkUrl:'/__wg_frozen_sdk__/sdk-browser/index.js',manifestUrl:renderManifestUrl,configuration,captureOnly,baselinePoses:poses?Object.fromEntries(poses.views.map(view=>[view.segment,view.pose])):null,expectedTextures:poses?.events.find(event=>event.phase==='material-textures-ready')?.context??null,sourceHasImages:!!sourceGltf.json.images?.length}));
 assert.deepEqual(result.errors,[]);assert.equal(result.fallbackReason,null);
 assert.deepEqual(result.consoleErrors,[],'Console errors invalidate the material/render comparison');
 assert.deepEqual(result.httpErrors,[],'Failed resources invalidate the material/render comparison');
 assert.equal(result.views.length,configuration.segments.length);
 assert.ok(!result.events.some(event=>/failed|uncaptured-error|device-lost/.test(event.phase)),'GPU or streaming failure');
 result.afterHashes=await buildHashes();assert.deepEqual(result.afterHashes,result.hashes,'Build or Lab sources changed during run');
 const finalManifest=await fetchArtifact(result.manifest.url),finalMetadata=await fetchArtifact(result.metadata.url),finalSource=await fetchArtifact(result.sourceGltf.url);
 result.finalCache={manifestSha256:finalManifest.sha256,metadataSha256:finalMetadata.sha256,key:finalMetadata.json.key,sourceGltfSha256:finalSource.sha256};
 assert.equal(finalManifest.sha256,result.manifest.sha256,'Manifest changed during measurement');assert.equal(finalMetadata.sha256,result.metadata.sha256,'Metadata changed during measurement');assert.equal(finalSource.sha256,result.sourceGltf.sha256,'Source glTF changed during measurement');
 if(baseline){
  assert.deepEqual(result.bounds,baseline.bounds,'Scene bounds differ');
  const canonicalGpu=gpu=>({...gpu,features:[...gpu.features].sort()});
  assert.deepEqual(canonicalGpu(result.gpu),canonicalGpu(baseline.gpu),'GPU adapter differs');
  result.baselineResult=resolve(process.env.BASELINE_RESULT);result.comparisons=[];
  for(const view of result.views){
   const previous=baseline.views.find(candidate=>candidate.segment===view.segment);assert.deepEqual(view.pose,previous.pose);
   const a=await readFile(resolve(process.env.BASELINE_RESULT,'..',`segment-${view.segment}.rgba`)),b=await readFile(resolve(out,`segment-${view.segment}.rgba`));assert.equal(a.length,b.length);
   let sum=0,differentPixels=0,maxChannelError=0;for(let i=0;i<a.length;i+=4){let changed=false;for(let c=0;c<3;c++){const d=Math.abs(a[i+c]-b[i+c]);sum+=d;if(d>2)changed=true;maxChannelError=Math.max(maxChannelError,d);}if(changed)differentPixels++;}
   result.comparisons.push({segment:view.segment,before:previous.summary,after:view.summary,pixels:{mae:sum/(a.length/4*3),differentPixelsAbove2:differentPixels,maxChannelError}});
  }
  if(configuration.pixelError===0)assert.ok(result.comparisons.every(comparison=>comparison.pixels.differentPixelsAbove2===0),'Exact-detail pixel equivalence failed');
  if(process.env.EXPECTED_MAX_CHANNEL_ERROR!==undefined){result.expectedMaxChannelError=Number(process.env.EXPECTED_MAX_CHANNEL_ERROR);assert.ok(Number.isFinite(result.expectedMaxChannelError)&&result.expectedMaxChannelError>=0,'EXPECTED_MAX_CHANNEL_ERROR must be finite and nonnegative');assert.ok(result.comparisons.every(comparison=>comparison.pixels.maxChannelError<=result.expectedMaxChannelError),'Requested pixel equivalence failed');}
 }
 result.status='passed';
}catch(error){result.status='failed';result.error=String(error);throw error;}
finally{result.finishedAt=new Date().toISOString();await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));await browser?.close();if(cacheServer){cacheServer.closeAllConnections();await new Promise(resolve=>cacheServer.close(resolve));}console.log(`Transparent LOD ${result.status}: ${out}`);}
