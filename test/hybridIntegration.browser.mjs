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
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-.2,-.2,0,.2,-.2,0,0,.2,0],3));geometry.setIndex([0,1,2]);
  const color=new THREE.DataTexture(new Uint8Array([255,80,30,255,255,80,30,255,255,80,30,255,255,80,30,255]),2,2);color.colorSpace=THREE.SRGBColorSpace;color.needsUpdate=true;
  const normal=new THREE.DataTexture(new Uint8Array([128,128,255,255,128,128,255,255,128,128,255,255,128,128,255,255]),2,2);normal.needsUpdate=true;
  const material=new THREE.MeshStandardMaterial({color:0xffffff,map:color,normalMap:normal,side:THREE.DoubleSide});const mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);source.updateMatrixWorld(true);
  const metadata={primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages:[{id:0,url:'0',count:3,min:[-.2,-.2,0],max:[.2,.2,0],bytes:12,sha256:'x'}],hierarchy:{min:[-.2,-.2,0],max:[.2,.2,0],page:0}}]};
  const events=[];const backend=webgpuPagesBackend({source,metadata,indices:new Map([['0',new Uint32Array([0,1,2])]]),associations:new Map([[mesh,{meshes:0,primitives:0}]]),gpuDevice:device,maxResidentPages:1,viewport:[32,32],clearColor:0x171d28,maxTextureTransferBytesPerFrame:16,onDiagnostic:event=>events.push(event)});
  const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=3;camera.lookAt(0,0,0);camera.updateMatrixWorld();
  await backend.prepare();const initialTextureMetrics=backend.metrics();for(let i=0;i<3;i++){backend.render(camera);await backend.flush();}
  const pixels=backend.capture(),sample=(x,y)=>Array.from(pixels.slice((y*32+x)*4,(y*32+x)*4+4));
  const result={center:sample(16,16),background:sample(0,0),capabilities:JSON.parse(JSON.stringify(backend.capabilities)),metrics:backend.metrics(),initialTextureMetrics,failures:events.filter(event=>/failed|uncaptured-error/.test(event.phase)).map(event=>({phase:event.phase,context:event.context})),errors};
  backend.dispose();geometry.dispose();material.dispose();color.dispose();normal.dispose();device.destroy();return result;
 });
 console.log(JSON.stringify(result,null,2));
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failures,[]);
 assert.equal(result.capabilities.unsupported.includes('small-triangle compute raster'),false);
 assert.equal(result.initialTextureMetrics.texturePending,1);assert.equal(result.metrics.texturePending,0);
 assert.notDeepEqual(result.center.slice(0,3),result.background.slice(0,3));
}finally{await browser.close();}
