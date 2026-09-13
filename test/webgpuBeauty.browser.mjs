import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const labRoot=process.env.LAB_ROOT??resolve('../render-tech-lab');
const {chromium}=createRequire(resolve(labRoot,'package.json'))('playwright');
import {writeFile,mkdir} from 'node:fs/promises';
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
const read=scene=>{renderer.setRenderTarget(null);renderer.render(scene,camera);const p=new Uint8Array(size*size*4);const gl=renderer.getContext();gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,p);return Array.from(p.slice((32*size+32)*4,(32*size+32)*4+4));};
const results=[];
for(const options of [{name:'white matte',color:0xffffff,roughness:1,metalness:0},{name:'grey matte',color:0x808080,roughness:1,metalness:0},{name:'metal',color:0x808080,roughness:.5,metalness:1},{name:'red',color:0x993322,roughness:.5,metalness:0},{name:'external ORM',color:0x808080,roughness:1,metalness:1,externalOrm:true},{name:'occlusion',color:0x808080,roughness:1,metalness:0,occlusion:true},{name:'emission',color:0x111111,roughness:1,metalness:0,emissive:0x881100}]){
const {name,externalOrm,occlusion,...params}=options,geometry=new THREE.PlaneGeometry(2,2);
let externalTexture;if(externalOrm){const c=document.createElement('canvas');c.width=c.height=2;const ctx=c.getContext('2d');ctx.fillStyle='rgb(255,255,0)';ctx.fillRect(0,0,2,2);externalTexture=new THREE.Texture(await createImageBitmap(c));externalTexture.needsUpdate=true;params.metalnessMap=externalTexture;params.roughnessMap=externalTexture;}
if(occlusion){const ao=new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1);ao.needsUpdate=true;params.aoMap=ao;params.aoMapIntensity=.8;externalTexture=ao;}
const material=new THREE.MeshStandardMaterial(params),mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);source.updateMatrixWorld(true);
const reference=new THREE.Scene();reference.background=new THREE.Color(0x2a303c);reference.add(mesh.clone());reference.add(new THREE.HemisphereLight(0xffffff,0x495061,2));const l=new THREE.DirectionalLight(0xffffff,2.5);l.position.set(1,3,2);reference.add(l);
const indices=new Map([['0',new Uint32Array(geometry.index.array)]]),metadata={primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages:[{id:0,url:'0',count:6,min:[-1,-1,0],max:[1,1,0],bytes:24,sha256:'x'}],hierarchy:{min:[-1,-1,0],max:[1,1,0],page:0}}]};
const backend=webgpuPagesBackend({source,metadata,indices,associations:new Map([[mesh,{meshes:0,primitives:0}]]),maxResidentPages:1,viewport:[size,size],gpuDevice:device,clearColor:0x2a303c});
await backend.prepare();for(let i=0;i<4;i++){backend.render(camera);await backend.flush();}
const blit=backend.scene.children.find(x=>x.userData.blit);const raw=Array.from(blit.material.uniforms.image.value.image.data.slice((32*size+32)*4,(32*size+32)*4+4));
results.push({name,reference:read(reference),webgpu:read(backend.scene),raw,capabilities:JSON.parse(JSON.stringify(backend.capabilities))});backend.dispose();geometry.dispose();material.dispose();externalTexture?.dispose();
}
renderer.dispose();device.destroy();return {results,errors,adapter:adapter.info};
});console.log(JSON.stringify(result.results.map(s=>({name:s.name,reference:s.reference,webgpu:s.webgpu})),null,2));
const output=process.env.BEAUTY_RESULT??'/tmp/webgpu-beauty-result.json';await writeFile(output,JSON.stringify(result,null,2));
assert.deepEqual(result.errors,[]);
for(const sample of result.results){assert.ok(!sample.capabilities.unsupported.includes('visibility buffer'),'real visibility shader required');const error=Math.max(...sample.reference.slice(0,3).map((c,i)=>Math.abs(c-sample.webgpu[i])));assert.ok(error<=2,`${sample.name}: reference ${sample.reference}, WebGPU ${sample.webgpu}, error ${error}`);}
}finally{await browser.close();}
