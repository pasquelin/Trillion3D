import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';

// Real GPU presentation/capture regression fixtures, outside timed beauty runs.
// Start Lab 15 and build this SDK before running. No performance claim is made.
const labRoot=resolve(process.env.LAB_ROOT??'../render-tech-lab');
const labUrl=process.env.LAB_URL??'http://localhost:5174';
const sdkRoot=resolve(process.env.PRESENTATION_SDK_ROOT??'.');
const distRoot=resolve(process.env.WEBGPU_DIST_DIR??resolve(sdkRoot,'dist'));
const out=resolve(process.env.PRESENTATION_RESULT??'benchmark-runs/gpu-presentation/result.json');
const {chromium}=createRequire(resolve(labRoot,'package.json'))('playwright');
const hashes={};
for(const name of ['webgpuPages','deferredLighting','gpuPresentation','visibilityBuffer'])hashes[name]=createHash('sha256').update(await readFile(resolve(distRoot,'sdk-browser',name+'.js'))).digest('hex');
const report={version:1,startedAt:new Date().toISOString(),purpose:'presentation-regression-only',distRoot,hashes,servedHashes:{},errors:[],checks:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();
 // Use Lab's module server without starting its dashboard or another renderer.
 await page.route('**/__wg-presentation-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>WebGeometry GPU presentation regression</title>'}));
 await page.route(/\/dist\/(?:sdk-browser|sdk-core)\//,async route=>{
  const path=decodeURIComponent(new URL(route.request().url()).pathname);
  const relative=path.match(/\/dist\/((?:sdk-browser|sdk-core)\/[\w./-]+\.js)$/)?.[1];
  assert.ok(relative&&!relative.split('/').includes('..'),'Unexpected SDK module path: '+path);
  const original=await readFile(resolve(distRoot,relative),'utf8');
  report.servedHashes[relative]=createHash('sha256').update(original).digest('hex');
  const body=original.replace(/\bfrom\s*(['"])three\1/g,"from '/.vite/deps/three.js'");
  await route.fulfill({status:200,contentType:'text/javascript',body});
 });
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(labUrl+'/__wg-presentation-fixture');
 Object.assign(report,await page.evaluate(async({sdkBase})=>{
  const THREE=await import('/.vite/deps/three.js');
  const {webgpuPagesBackend}=await import(sdkBase+'/webgpuPages.js');
  const {createSynchronousCanvasCapture}=await import(sdkBase+'/gpuPresentation.js');
  const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw Error('No WebGPU adapter');
  const device=await adapter.requestDevice();const gpuErrors=[],checks=[],events=[],passes=[];
  device.addEventListener('uncapturederror',event=>gpuErrors.push(event.error.message));
  const createEncoder=device.createCommandEncoder.bind(device);
  device.createCommandEncoder=(descriptor)=>{
   const encoder=createEncoder(descriptor),begin=encoder.beginRenderPass.bind(encoder);
   encoder.beginRenderPass=(descriptor)=>{
    passes.push({name:descriptor.label??'',colorAttachments:descriptor.colorAttachments.filter(Boolean).length});
    return begin(descriptor);
   };
   return encoder;
  };
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  const equal=(a,b,name)=>{
   check(a.length===b.length,name+': image dimensions differ');
   let differentChannels=0,maxChannelError=0;
   for(let i=0;i<a.length;i++){if(a[i]!==b[i])differentChannels++;maxChannelError=Math.max(maxChannelError,Math.abs(a[i]-b[i]));}
   checks.push({name,bytes:a.length,differentChannels,maxChannelError});
   check(differentChannels===0,name+': '+differentChannels+' channels differ (max '+maxChannelError+')');
  };
  const checkNormalPasses=(name,encoded)=>{
   const composition=encoded.filter(pass=>pass.name.startsWith('WG HDR composition'));
   check(composition.length===1&&composition[0].colorAttachments===2,name+': expected one HDR composition with both display targets');
   check(!encoded.some(pass=>pass.name==='WG direct present'),name+': redundant presentation pass');
   checks.push({name:name+' passes',passes:encoded});
  };
  const capture=createSynchronousCanvasCapture();
  const texture=(bytes,width=2,height=2,color=false)=>{
   const value=new THREE.DataTexture(new Uint8Array(bytes),width,height);
   if(color)value.colorSpace=THREE.SRGBColorSpace;
   value.needsUpdate=true;return value;
  };
  const fixtures=[
   {name:'unlit',kind:'unlit'},
   {name:'textured PBR',kind:'pbr'},
   {name:'masked PBR',kind:'mask'},
   {name:'transparent PBR',kind:'blend'},
   {name:'implicit canvas',kind:'pbr',implicitCanvas:true},
  ];
  try{
   for(const fixture of fixtures){
    const source=new THREE.Group(),geometries=[],materials=[],textures=[],indices=new Map(),associations=new Map(),primitives=[];
    const colorMap=texture([230,32,70,255,18,180,240,0,200,155,5,255,30,225,85,255],2,2,true);
    const normalMap=texture([140,110,250,255],1,1);
    const ormMap=texture([145,190,90,255],1,1);textures.push(colorMap,normalMap,ormMap);
    const addPlane=(material,z,transparent=false)=>{
     const geometry=new THREE.PlaneGeometry(2,2),mesh=new THREE.Mesh(geometry,material),meshIndex=primitives.length;
     mesh.position.z=z;source.add(mesh);geometries.push(geometry);materials.push(material);
     const min=[-1,-1,0],max=[1,1,0],url='fixture-'+meshIndex;
     primitives.push({mesh:meshIndex,primitive:0,pass:transparent?'shared-blend':'exact-clusters',pages:[{id:0,url,count:6,min,max,bytes:24,sha256:'fixture'}]});
     indices.set(url,new Uint32Array(geometry.index.array));associations.set(mesh,{meshes:meshIndex,primitives:0});
    };
    const pbr={color:0xc5cbd8,roughness:.63,metalness:.31,map:colorMap,normalMap,normalScale:new THREE.Vector2(.75,-.4),roughnessMap:ormMap,metalnessMap:ormMap,aoMap:ormMap,aoMapIntensity:.8,emissive:0x160903};
    if(fixture.kind==='blend')addPlane(new THREE.MeshStandardMaterial({color:0x287ba6,roughness:.9}),-.3);
    addPlane(fixture.kind==='unlit'?new THREE.MeshBasicMaterial({color:0xd9236a}):new THREE.MeshStandardMaterial({...pbr,...fixture.kind==='mask'?{alphaTest:.5}:fixture.kind==='blend'?{transparent:true,opacity:.43,side:THREE.DoubleSide}:{}}),0,fixture.kind==='blend');
    source.updateMatrixWorld(true);
    const canvas=fixture.implicitCanvas?undefined:document.createElement('canvas');if(canvas)document.body.append(canvas);
    const viewport=[64,48],camera=new THREE.PerspectiveCamera(55,viewport[0]/viewport[1],.1,100);
    camera.position.set(.15,.1,3);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    const backend=webgpuPagesBackend({source,metadata:{primitives},indices,associations,gpuDevice:device,gpuCanvas:canvas,maxResidentPages:8,viewport,clearColor:0x2a303c,diagnosticDetail:'summary',onDiagnostic:event=>events.push({fixture:fixture.name,...event})});
    try{
     await backend.prepare();backend.render(camera);await backend.flush();
     const outputCanvas=canvas??backend.scene.children.find(object=>object.userData.blit)?.material.uniforms.image.value.image;
     check(outputCanvas instanceof HTMLCanvasElement,fixture.name+': no output canvas');
     const frame=async(name,options={})=>{
      const start=passes.length;backend.render(camera);
      const encoded=passes.slice(start);checkNormalPasses(name,encoded);
      // Read the canvas within the same task, before the swapchain can expire.
      const shown=capture.read(outputCanvas);
      await backend.flush();const pixels=backend.capture().slice();
      equal(shown,pixels,name+' canvas versus GPU target');
      if(options.synchronous){
       // A fresh render invalidates the async cache; compare its synchronous
       // capture with the preceding identical frame's independent GPU readback.
       const renderStart=passes.length;backend.render(camera);checkNormalPasses(name+' synchronous render',passes.slice(renderStart));
       const syncStart=passes.length,synchronous=backend.capture().slice();
       check(passes.slice(syncStart).some(pass=>pass.name==='WG direct present'),name+': explicit synchronous capture must re-present the persistent target');
       equal(synchronous,pixels,name+' synchronous versus async capture');
      }
      check(outputCanvas.width===viewport[0]&&outputCanvas.height===viewport[1],name+': canvas size mismatch');
      if(options.empty){
       check(encoded.every(pass=>pass.name!=='WG transparents'),name+': empty transparency pass');
       check(pixels.every((value,i)=>value===[42,48,60,255][i%4]),name+': clear color changed');
      }else check(pixels.some((value,i)=>i%4<3&&value!==[42,48,60][i%4]),name+': image is empty');
      return pixels;
     };
     await frame(fixture.name,{synchronous:true});
     if(fixture.kind==='blend')check(passes.some(pass=>pass.name==='WG transparents'),fixture.name+': transparent pass was not exercised');
     if(fixture.kind!=='blend'){
      for(const mode of ['wireframe','clusters','pages']){backend.setDiagnostic(mode);await frame(fixture.name+' '+mode);}
      backend.setDiagnostic('beauty');
     }
     viewport[0]=73;viewport[1]=45;camera.aspect=viewport[0]/viewport[1];camera.updateProjectionMatrix();
     const beforeSurface=await frame(fixture.name+' resized');
     const other=camera.clone();other.position.x=.8;other.lookAt(0,0,0);other.updateMatrixWorld();
     const surfaceStart=passes.length;
     const surface=await backend.captureSurfaceView(other,{width:35,height:27});
     try{
      check(surface.width===35&&surface.height===27,fixture.name+': surface capture dimensions');
      check(surface.cameraWorld[0]===.8,fixture.name+': surface camera was ignored');
      const surfacePasses=passes.slice(surfaceStart);
      check(!surfacePasses.some(pass=>pass.name.startsWith('WG HDR composition')&&pass.colorAttachments===2),fixture.name+': secondary capture touched the visible canvas');
      check(surfacePasses.filter(pass=>pass.name==='WG direct present').length===1,fixture.name+': main canvas was not restored once');
      const restored=capture.read(outputCanvas);equal(restored,beforeSurface,fixture.name+' secondary restore canvas');
      await backend.flush();equal(backend.capture(),beforeSurface,fixture.name+' secondary restore GPU target');
      check(viewport[0]===73&&viewport[1]===45&&outputCanvas.width===73&&outputCanvas.height===45,fixture.name+': secondary dimensions leaked into main view');
      checks.push({name:fixture.name+' secondary camera',passes:surfacePasses});
     }finally{surface.dispose();}
     camera.position.set(100,0,3);camera.lookAt(100,0,0);camera.updateMatrixWorld();
     await frame(fixture.name+' empty',{empty:true});
     check(!backend.capabilities.unsupported.includes('visibility buffer'),fixture.name+': visibility fallback occurred');
    }finally{backend.dispose();canvas?.remove();geometries.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());textures.forEach(value=>value.dispose());}
   }
   await device.queue.onSubmittedWorkDone();
   check(!events.some(event=>/failed|uncaptured-error/.test(event.phase)),'Backend reported a GPU failure');
   check(gpuErrors.length===0,'WebGPU validation errors: '+gpuErrors.join('; '));
   return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description},checks,gpuErrors,events,userAgent:navigator.userAgent};
  }finally{capture.dispose();device.destroy();}
 },{sdkBase:'/@fs'+resolve(sdkRoot,'dist/sdk-browser')}));
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.gpuErrors,[]);
 assert.ok(report.checks.length>=50,'All presentation cases must execute');
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error);throw error;}
finally{report.finishedAt=new Date().toISOString();await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({status:report.status,adapter:report.adapter,checks:report.checks.length,result:out}));
