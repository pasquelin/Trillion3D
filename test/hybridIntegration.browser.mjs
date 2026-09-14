import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const {chromium}=createRequire(resolve(process.env.LAB_ROOT??'../render-tech-lab','package.json'))('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto(process.env.WG_URL??'http://127.0.0.1:5177/test/browser-test.html');
 const result=await page.evaluate(async()=>{
  const THREE=await import('/node_modules/three/build/three.module.js');
  const {webgpuPagesBackend}=await import('/packages/sdk-browser/webgpuPages.ts');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('NO_ADAPTER');
  const device=await adapter.requestDevice();const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-.2,-.2,0,.2,-.2,0,0,.2,0,-1,-.2,0,-.6,-.2,0,-.8,.2,0],3));geometry.setIndex([0,1,2]);
  const color=new THREE.DataTexture(new Uint8Array([255,80,30,255,255,80,30,255,255,80,30,255,255,80,30,255]),2,2);color.colorSpace=THREE.SRGBColorSpace;color.needsUpdate=true;
  const normal=new THREE.DataTexture(new Uint8Array([128,128,255,255,128,128,255,255,128,128,255,255,128,128,255,255]),2,2);normal.needsUpdate=true;
  const material=new THREE.MeshStandardMaterial({color:0xffffff,map:color,normalMap:normal,side:THREE.DoubleSide});const mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);source.updateMatrixWorld(true);
  const metadata={primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages:[
   {id:0,url:'0',count:3,min:[-.2,-.2,0],max:[.2,.2,0],bytes:12,sha256:'x'},
   {id:1,url:'coarse',count:3,min:[-1,-.2,0],max:[-.6,.2,0],bytes:12,sha256:'c',role:'coarse'},
  ]}]};
  const events=[];const backend=webgpuPagesBackend({source,metadata,indices:new Map([['0',new Uint32Array([0,1,2])],['coarse',new Uint32Array([3,4,5])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),gpuDevice:device,maxResidentPages:2,pixelError:1,viewport:[32,32],clearColor:0x171d28,maxTextureTransferBytesPerFrame:16,onDiagnostic:event=>events.push(event)});
  const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=3;camera.lookAt(0,0,0);camera.updateMatrixWorld();
  await backend.prepare();const initialTextureMetrics=backend.metrics();for(let i=0;i<3;i++){backend.render(camera);await backend.flush();}
  const snapshot=()=>{const pixels=backend.capture(),sample=(x,y)=>Array.from(pixels.slice((y*32+x)*4,(y*32+x)*4+4));return {center:sample(16,16),coarse:sample(8,16),background:sample(0,0),selected:backend.selectedPageIds(),residentPages:backend.metrics().residentPages};};
  const initial=snapshot(),motion=[];
  for(const away of [true,false,true,false]){
   camera.lookAt(away?100:0,0,away?3:0);camera.updateMatrixWorld();
   backend.render(camera);await backend.flush();motion.push({away,...snapshot()});
  }
  const result={...initial,motion,capabilities:JSON.parse(JSON.stringify(backend.capabilities)),metrics:backend.metrics(),initialTextureMetrics,gpuFrames:events.filter(event=>event.phase==='gpu-selection-current-frame').length,cpuSelections:events.filter(event=>event.phase==='cpu-selection').length,failures:events.filter(event=>/failed|uncaptured-error/.test(event.phase)).map(event=>({phase:event.phase,context:event.context})),errors};
  backend.dispose();geometry.dispose();material.dispose();color.dispose();normal.dispose();device.destroy();return result;
 });
 console.log(JSON.stringify(result,null,2));
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failures,[]);
 assert.equal(result.capabilities.unsupported.includes('small-triangle compute raster'),false);
 assert.equal(result.capabilities.gpuDriven,true);assert.ok(result.gpuFrames>0);assert.equal(result.cpuSelections,0);
 assert.equal(result.initialTextureMetrics.texturePending,1);assert.equal(result.metrics.texturePending,0);
 assert.notDeepEqual(result.center.slice(0,3),result.background.slice(0,3));
 assert.equal(result.residentPages,2,'both coarse and fine remain resident candidates');
 assert.deepEqual(result.selected,['0']);
 assert.deepEqual(result.coarse,result.background,'rejected resident coarse page must not enter compute raster');
 for(const sample of result.motion){
  assert.deepEqual(sample.selected,sample.away?[]:['0']);
  if(sample.away)assert.deepEqual(sample.center,sample.background,'moving away removes current GPU geometry');
  else assert.notDeepEqual(sample.center.slice(0,3),sample.background.slice(0,3),'returning camera restores the current fine page');
  assert.deepEqual(sample.coarse,sample.background,'resident coarse remains absent during camera motion');
 }
}finally{await browser.close();}
