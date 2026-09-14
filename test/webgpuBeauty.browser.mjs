import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const labRoot=process.env.LAB_ROOT??resolve('../render-tech-lab');
const {chromium}=createRequire(resolve(labRoot,'package.json'))('playwright');
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
const page=await browser.newPage();
page.on('console',m=>{if(m.type()==='error')console.error(m.text())});
await page.goto((process.env.LAB_URL??'http://localhost:5174')+'/?test=15-virtualized-integration');
const result=await page.evaluate(async()=>{
const THREE=await import('/.vite/deps/three.js');
const {benchEngine}=await import('/15-virtualized-integration/implementation/engines.ts');const webgpuPagesBackend=benchEngine('webgpu-page-raster').factory;
const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No GPU');
const device=await adapter.requestDevice({requiredFeatures:adapter.features.has('indirect-first-instance')?['indirect-first-instance']:[]});const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
const canvas=document.createElement('canvas'),size=64;
const renderer=new THREE.WebGLRenderer({canvas,antialias:false});renderer.setSize(size,size);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
const camera=new THREE.PerspectiveCamera(55,1,.1,100);camera.position.z=3;camera.lookAt(0,0,0);camera.updateMatrixWorld();
const read=scene=>{renderer.setRenderTarget(null);renderer.render(scene,camera);const p=new Uint8Array(size*size*4);const gl=renderer.getContext();gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
const results=[];
for(const options of [{name:'white matte',color:0xffffff,roughness:1,metalness:0},{name:'grey matte',color:0x808080,roughness:1,metalness:0},{name:'metal',color:0x808080,roughness:.5,metalness:1},{name:'red',color:0x993322,roughness:.5,metalness:0},{name:'external ORM',color:0x808080,roughness:1,metalness:1,externalOrm:true},{name:'occlusion',color:0x808080,roughness:1,metalness:0,occlusion:true},{name:'emission',color:0x111111,roughness:1,metalness:0,emissive:0x881100},{name:'minified texture',color:0xffffff,roughness:1,metalness:0,minified:true},{name:'normal scale XY',color:0x808080,roughness:.8,metalness:0,normalTest:'scale'},{name:'mirrored normal UV',color:0x808080,roughness:.8,metalness:0,normalTest:'mirror'},{name:'authored tangents',color:0x808080,roughness:.8,metalness:0,normalTest:'tangent'},{name:'transparent authored tangents',color:0x808080,roughness:.8,metalness:0,normalTest:'tangent',transparent:true,opacity:.8},{name:'near-plane normal',color:0x808080,roughness:.8,metalness:0,normalTest:'clipped',side:THREE.DoubleSide},{name:'grazing normal',color:0x808080,roughness:.8,metalness:0,normalTest:'grazing'},{name:'back face normal',color:0x808080,roughness:.8,metalness:0,normalTest:'back'},{name:'transparent back face normal',color:0x808080,roughness:.8,metalness:0,normalTest:'back',transparent:true,opacity:.8},{name:'transparent PBR',color:0x808080,roughness:1,metalness:0,transparent:true,opacity:.5},{name:'transparent ORM',color:0x808080,roughness:1,metalness:1,transparent:true,opacity:.8,externalOrm:true}]){
const {name,externalOrm,occlusion,minified,normalTest,...params}=options,geometry=new THREE.PlaneGeometry(2,2);
let externalTexture;if(externalOrm){const c=document.createElement('canvas');c.width=c.height=2;const ctx=c.getContext('2d');ctx.fillStyle='rgb(255,255,0)';ctx.fillRect(0,0,2,2);externalTexture=new THREE.Texture(await createImageBitmap(c));externalTexture.needsUpdate=true;params.metalnessMap=externalTexture;params.roughnessMap=externalTexture;}
if(occlusion){const ao=new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1);ao.needsUpdate=true;params.aoMap=ao;params.aoMapIntensity=.8;externalTexture=ao;}
if(minified){const texels=new Uint8Array(128*128*4);for(let y=0;y<128;y++)for(let x=0;x<128;x++){const o=(y*128+x)*4;texels[o]=texels[o+1]=texels[o+2]=((x+y)%2)*255;texels[o+3]=255;}const t=new THREE.DataTexture(texels,128,128);t.colorSpace=THREE.SRGBColorSpace;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.needsUpdate=true;params.map=t;externalTexture=t;const uv=geometry.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*64+.123,uv.getY(i)*64+.123);}
if(normalTest){const t=new THREE.DataTexture(new Uint8Array([160,210,230,255]),1,1);t.needsUpdate=true;params.normalMap=t;externalTexture=t;if(normalTest==='tangent'){geometry.setAttribute('tangent',new THREE.Float32BufferAttribute(Array.from({length:4},()=>[0,1,0,-1]).flat(),4));}if(normalTest==='grazing')geometry.rotateY(1.4);if(normalTest==='clipped')geometry.scale(10,10,1).rotateY(1.4);if(normalTest==='back'){geometry.rotateY(Math.PI);params.side=THREE.DoubleSide;}if(normalTest==='scale')params.normalScale=new THREE.Vector2(1,-.5);if(normalTest==='mirror'){const uv=geometry.attributes.uv;for(let i=0;i<uv.count;i++)uv.setX(i,-uv.getX(i));}}
const material=new THREE.MeshStandardMaterial(params),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);source.updateMatrixWorld(true);
const reference=new THREE.Scene();reference.background=new THREE.Color(0x2a303c);reference.add(mesh.clone());reference.add(new THREE.HemisphereLight(0xffffff,0x495061,2));const l=new THREE.DirectionalLight(0xffffff,2.5);l.position.set(1,3,2);reference.add(l);
geometry.computeBoundingBox();const min=geometry.boundingBox.min.toArray(),max=geometry.boundingBox.max.toArray();
const indices=new Map([['0',new Uint32Array(geometry.index.array)]]),metadata={primitives:[{mesh:0,primitive:0,pass:params.transparent?'shared-blend':'exact-clusters',pages:[{id:0,url:'0',count:6,min,max,bytes:24,sha256:'x'}]}]};
const events=[];const backend=webgpuPagesBackend({source,metadata,indices,associations:new Map([[mesh,{meshes:0,primitives:0}]]),maxResidentPages:1,viewport:[size,size],gpuDevice:device,clearColor:0x2a303c,onDiagnostic:event=>events.push(event)});
await backend.prepare();for(let i=0;i<4;i++){backend.render(camera);await backend.flush();}
const raw=Array.from(backend.capture().slice((32*size+32)*4,(32*size+32)*4+4));
const referencePixels=read(reference),webgpuPixels=read(backend.scene);const pixel=(pixels,x,y)=>Array.from(pixels.slice((y*size+x)*4,(y*size+x)*4+4));
const samples=[20,32,44].flatMap(y=>[20,32,44].map(x=>({x,y,reference:pixel(referencePixels,x,y),webgpu:pixel(webgpuPixels,x,y)})));
results.push({name,events,samples,reference:pixel(referencePixels,32,32),webgpu:pixel(webgpuPixels,32,32),raw,capabilities:JSON.parse(JSON.stringify(backend.capabilities))});backend.dispose();geometry.dispose();material.dispose();externalTexture?.dispose();
}
renderer.dispose();device.destroy();return {results,errors,adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description},userAgent:navigator.userAgent};
});console.log(JSON.stringify(result.results.map(s=>({name:s.name,reference:s.reference,webgpu:s.webgpu})),null,2));
const output=process.env.BEAUTY_RESULT??'/tmp/webgpu-beauty-result.json';await writeFile(output,JSON.stringify(result,null,2));
assert.deepEqual(result.errors,[]);
for(const sample of result.results){for(const phase of ['material-textures','material-textures-ready','render-capabilities','first-readback'])assert.ok(sample.events.some(event=>event.phase===phase),`${sample.name}: missing log ${phase}`);assert.ok(!sample.events.some(event=>/failed|uncaptured-error/.test(event.phase)),`${sample.name}: GPU diagnostic error`);assert.ok(!sample.capabilities.unsupported.includes('visibility buffer'),'real visibility shader required');for(const point of sample.samples){const error=Math.max(...point.reference.slice(0,3).map((c,i)=>Math.abs(c-point.webgpu[i])));assert.ok(error<=2,`${sample.name} (${point.x},${point.y}): reference ${point.reference}, WebGPU ${point.webgpu}, error ${error}`);}}
}finally{await browser.close();}
