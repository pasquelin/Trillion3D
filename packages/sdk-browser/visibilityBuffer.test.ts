import {DEFERRED_LIGHTING_SHADER} from './deferredLighting.ts';
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from 'three';
import {compareImages} from '../sdk-core/index.ts';
import {opaqueBackgroundRgba,rasterPages} from './pageRaster.ts';

test('the WebGPU display buffer starts with the shared opaque scene background',()=>{
 assert.deepEqual([...opaqueBackgroundRgba(2,1)],[0x17,0x1d,0x28,255,0x17,0x1d,0x28,255]);
});
import {packVisibilityId,unpackVisibilityId,rasterVisibilityIds,shadeVisibility,visibilityUvDerivatives,visMaterial,isTransmissive,VIS_INVALID,VIS_SHADER,SHADE_SHADER,type VisPage} from './visibilityBuffer.ts';

function camera(){
 const cam=new THREE.PerspectiveCamera(55,1,.1,100);cam.position.z=5;cam.lookAt(0,0,0);cam.updateMatrixWorld();return cam;
}

function quadPages(material:THREE.Material,uv?:number[]):{pages:VisPage[];geometry:THREE.BufferGeometry}{
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));
 if(uv)geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 geometry.setIndex([0,1,2,0,2,3]);
 const pages:VisPage[]=[
  {array:new Uint32Array([0,1,2]),attributes:geometry.attributes,matrix:new THREE.Matrix4(),material,clusterId:'0/0/0'},
  {array:new Uint32Array([0,2,3]),attributes:geometry.attributes,matrix:new THREE.Matrix4(),material,clusterId:'0/0/1'},
 ];
 return {pages,geometry};
}

function centerId(ids:Uint32Array,width:number,height:number){return ids[((height/2)|0)*width+((width/2)|0)];}

test('SHADE_SHADER implements mat3 inverse-transpose without the missing WGSL inverse builtin',()=>{
 assert.match(SHADE_SHADER,/fn inverseTranspose3\s*\(/);
 assert.doesNotMatch(SHADE_SHADER,/\binverse\s*\(/);
});
test('SHADE_SHADER early returns on background or invalid pixels before texture sampling',()=>{
 const fs=SHADE_SHADER.slice(SHADE_SHADER.indexOf('fn shade_fs'));
 const firstReturn=fs.indexOf('return');
 const sampleAt=fs.indexOf('textureSampleGrad');
 assert.ok(firstReturn>=0&&sampleAt>=0);
 assert.ok(firstReturn<sampleAt);
});
test('CPU visibility shading uses the host background when no triangle is visible',()=>{
 const material=new THREE.MeshBasicMaterial({color:0xffffff});
 const {pages,geometry}=quadPages(material);
 const cam=camera(),size:[number,number]=[4,4],ids=new Uint32Array(16);
 const image=shadeVisibility(ids,pages,cam,size,0x2d4059);
 assert.deepEqual([...image.slice(0,4)],[0x2d,0x40,0x59,255]);
 geometry.dispose();material.dispose();
});
test('visibility ids pack a page and triangle and reserve 0 for the background',()=>{
 assert.equal(unpackVisibilityId(VIS_INVALID),null);
 assert.deepEqual(unpackVisibilityId(packVisibilityId(0,0)),{pageIndex:0,triangleIndex:0});
 assert.deepEqual(unpackVisibilityId(packVisibilityId(2,7)),{pageIndex:2,triangleIndex:7});
 assert.notEqual(packVisibilityId(0,1),packVisibilityId(1,0));
 assert.throws(()=>packVisibilityId(-1,0));
});

test('visibility ids are stable for the same pose and differ per triangle',()=>{
 const material=new THREE.MeshBasicMaterial({color:0xff0000});
 const {pages,geometry}=quadPages(material);
 const cam=camera(),size:[number,number]=[32,32];
 const a=rasterVisibilityIds(pages,cam,size),b=rasterVisibilityIds(pages,cam,size);
 assert.deepEqual(a,b);
 const id=centerId(a,32,32);
 assert.notEqual(id,VIS_INVALID);
 const unpacked=unpackVisibilityId(id)!;
 assert.ok(unpacked.pageIndex===0||unpacked.pageIndex===1);
 assert.equal(unpacked.triangleIndex,0);
 const ids=new Set(a.filter(v=>v!==VIS_INVALID));
 assert.equal(ids.size,2);
 const clusters=new Set([...ids].map(v=>pages[unpackVisibilityId(v)!.pageIndex].clusterId));
 assert.equal(clusters.size,2);
 geometry.dispose();material.dispose();
});

test('the closer triangle wins the visibility id when two pages overlap',()=>{
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([
  -1,-1,0,1,-1,0,1,1,0,
  -1,-1,1,1,-1,1,1,1,1,
 ],3));
 const far:VisPage={array:new Uint32Array([0,1,2]),attributes:geometry.attributes,matrix:new THREE.Matrix4(),material:new THREE.MeshBasicMaterial({color:0xff0000}),clusterId:'far'};
 const near:VisPage={array:new Uint32Array([3,4,5]),attributes:geometry.attributes,matrix:new THREE.Matrix4(),material:new THREE.MeshBasicMaterial({color:0x00ff00}),clusterId:'near'};
 const cam=camera(),ids=rasterVisibilityIds([far,near],cam,[32,32]);
 const unpacked=unpackVisibilityId(centerId(ids,32,32));
 assert.deepEqual(unpacked,{pageIndex:1,triangleIndex:0});
 geometry.dispose();far.material.dispose();near.material.dispose();
});

test('visbuffer beauty for untextured MeshBasicMaterial matches the documented rasterPages reference',()=>{
 const material=new THREE.MeshBasicMaterial({color:0xff0000});
 const {pages,geometry}=quadPages(material);
 const cam=camera(),size:[number,number]=[32,32];
 const ids=rasterVisibilityIds(pages,cam,size);
 const beauty=shadeVisibility(ids,pages,cam,size);
 const expected=rasterPages(pages,cam,size);
 const image=compareImages(expected,beauty);
 assert.equal(image.maxChannelError,0);
 geometry.dispose();material.dispose();
});

test('the second pass samples the source map at reconstructed UVs',()=>{
 const map=new THREE.DataTexture(new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]),2,2,THREE.RGBAFormat);
 map.magFilter=THREE.NearestFilter;map.minFilter=THREE.NearestFilter;map.flipY=false;map.needsUpdate=true;
 const material=new THREE.MeshBasicMaterial({color:0xffffff,map});
 const {pages,geometry}=quadPages(material,[0.25,0.25,0.25,0.25,0.25,0.25,0.25,0.25]);
 const cam=camera(),size:[number,number]=[16,16];
 const ids=rasterVisibilityIds(pages,cam,size);
 const beauty=shadeVisibility(ids,pages,cam,size);
 const id=centerId(ids,16,16);
 assert.notEqual(id,VIS_INVALID);
 const o=(((16/2)|0)*16+((16/2)|0))*4;
 assert.equal(beauty[o],255);assert.equal(beauty[o+1],0);assert.equal(beauty[o+2],0);
 const untextured=new THREE.MeshBasicMaterial({color:0xffffff});
 const white=shadeVisibility(ids,pages.map(page=>({...page,material:untextured})),cam,size);
 assert.ok(compareImages(beauty,white).maxChannelError>0);
 geometry.dispose();material.dispose();untextured.dispose();map.dispose();
});

test('UV derivatives come from the winning triangle, not a neighbour across a visbuffer seam',()=>{
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,-1,0,1,1,0,-1,1,0],3));
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,0,0,0,0,1,1,1,1,1,1],2));
 const material=new THREE.MeshBasicMaterial({color:0xffffff});
 const pages:VisPage[]=[
  {array:new Uint32Array([0,1,2]),attributes:geometry.attributes,matrix:new THREE.Matrix4(),material,clusterId:'left'},
  {array:new Uint32Array([3,4,5]),attributes:geometry.attributes,matrix:new THREE.Matrix4(),material,clusterId:'right'},
 ];
 const cam=camera(),size:[number,number]=[32,32];
 const ids=rasterVisibilityIds(pages,cam,size);
 let left:{x:number;y:number}|undefined,right:{x:number;y:number}|undefined;
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){
  const unpacked=unpackVisibilityId(ids[y*32+x]);if(!unpacked)continue;
  if(unpacked.pageIndex===0&&!left)left={x,y};
  if(unpacked.pageIndex===1)right={x,y};
 }
 assert.ok(left&&right);
 const dLeft=visibilityUvDerivatives(ids,pages,cam,size,left!.x,left!.y)!;
 const dRight=visibilityUvDerivatives(ids,pages,cam,size,right!.x,right!.y)!;
 assert.ok(Math.hypot(dLeft.duDx,dLeft.dvDx,dLeft.duDy,dLeft.dvDy)<1e-5);
 assert.ok(Math.hypot(dRight.duDx,dRight.dvDx,dRight.duDy,dRight.dvDy)<1e-5);
 geometry.dispose();material.dispose();
});

test('Repeat wrap samples the same texel at UV 0.25 and 1.25',()=>{
 const map=new THREE.DataTexture(new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]),2,2,THREE.RGBAFormat);
 map.magFilter=THREE.NearestFilter;map.minFilter=THREE.NearestFilter;map.wrapS=THREE.RepeatWrapping;map.wrapT=THREE.RepeatWrapping;map.flipY=false;map.needsUpdate=true;
 const a=new THREE.MeshBasicMaterial({color:0xffffff,map});
 const b=new THREE.MeshBasicMaterial({color:0xffffff,map});
 const left=quadPages(a,[0.25,0.25,0.25,0.25,0.25,0.25,0.25,0.25]);
 const right=quadPages(b,[1.25,0.25,1.25,0.25,1.25,0.25,1.25,0.25]);
 const cam=camera(),size:[number,number]=[16,16];
 const ids=rasterVisibilityIds(left.pages,cam,size);
 const image=compareImages(shadeVisibility(ids,left.pages,cam,size),shadeVisibility(rasterVisibilityIds(right.pages,cam,size),right.pages,cam,size));
 assert.equal(image.maxChannelError,0);
 left.geometry.dispose();right.geometry.dispose();a.dispose();b.dispose();map.dispose();
});

test('FrontSide visbuffer culls a back-facing triangle',()=>{
 const material=new THREE.MeshBasicMaterial({color:0xff0000,side:THREE.FrontSide});
 const {pages,geometry}=quadPages(material);
 const cam=new THREE.PerspectiveCamera(55,1,.1,100);cam.position.z=-5;cam.lookAt(0,0,0);cam.updateMatrixWorld();
 const ids=rasterVisibilityIds(pages,cam,[16,16]);
 assert.ok([...ids].every(id=>id===VIS_INVALID));
 geometry.dispose();material.dispose();
});

test('a metalness map B=0 keeps a dielectric; B=1 is a metal',()=>{
 const dielectric=new THREE.DataTexture(new Uint8Array([0,255,0,255]),1,1,THREE.RGBAFormat);
 const metal=new THREE.DataTexture(new Uint8Array([0,255,255,255]),1,1,THREE.RGBAFormat);
 const a=new THREE.MeshStandardMaterial({color:0xffffff,metalness:1,roughness:1,metalnessMap:dielectric});
 const b=new THREE.MeshStandardMaterial({color:0xffffff,metalness:1,roughness:1,metalnessMap:metal});
 const {pages,geometry}=quadPages(a,[0,0,1,0,1,1,0,1]);
 const metalPages=pages.map(page=>({...page,material:b}));
 const cam=camera(),size:[number,number]=[16,16];
 const ids=rasterVisibilityIds(pages,cam,size);
 const dark=shadeVisibility(ids,pages,cam,size),bright=shadeVisibility(ids,metalPages,cam,size);
 assert.ok(compareImages(dark,bright).maxChannelError>0);
 assert.equal(visMaterial(a).metalness,1);
 assert.ok(visMaterial(a).metalnessMap);
 geometry.dispose();a.dispose();b.dispose();dielectric.dispose();metal.dispose();
});
test('a roughness map G channel changes the GGX highlight',()=>{
 const smooth=new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1,THREE.RGBAFormat);
 const rough=new THREE.DataTexture(new Uint8Array([0,255,0,255]),1,1,THREE.RGBAFormat);
 const a=new THREE.MeshStandardMaterial({color:0xffffff,metalness:1,roughness:1,roughnessMap:smooth});
 const b=new THREE.MeshStandardMaterial({color:0xffffff,metalness:1,roughness:1,roughnessMap:rough});
 const {pages,geometry}=quadPages(a,[0,0,1,0,1,1,0,1]);
 const roughPages=pages.map(page=>({...page,material:b}));
 const cam=camera(),size:[number,number]=[16,16];
 const ids=rasterVisibilityIds(pages,cam,size);
 assert.ok(compareImages(shadeVisibility(ids,pages,cam,size),shadeVisibility(ids,roughPages,cam,size)).maxChannelError>0);
 geometry.dispose();a.dispose();b.dispose();smooth.dispose();rough.dispose();
});
test('transmissive MeshPhysicalMaterial is not packed for the visbuffer',()=>{
 const material=new THREE.MeshPhysicalMaterial({color:0x228866,transmission:1,thickness:0.02,roughness:0,metalness:0});
 assert.equal(visMaterial(material).transmission,1);
 assert.equal(isTransmissive(material),true);
 assert.equal(isTransmissive(new THREE.MeshStandardMaterial()),false);
 material.dispose();
});
test('MeshStandardMaterial visbuffer lighting implements Cook-Torrance GGX microfacet BRDF',()=>{
 const basic=new THREE.MeshBasicMaterial({color:0x331111});
 const standard=new THREE.MeshStandardMaterial({color:0x331111,metalness:0,roughness:1});
 const {pages,geometry}=quadPages(basic);
 const litPages=pages.map(page=>({...page,material:standard}));
 const cam=camera(),size:[number,number]=[16,16];
 const ids=rasterVisibilityIds(pages,cam,size);
 assert.deepEqual(ids,rasterVisibilityIds(litPages,cam,size));
 const unlit=shadeVisibility(ids,pages,cam,size);
 const lit=shadeVisibility(ids,litPages,cam,size);
 assert.ok(compareImages(unlit,lit).maxChannelError>0);
 assert.match(DEFERRED_LIGHTING_SHADER, /alpha2\s*\/\s*\(3\.14159265/);
 assert.match(DEFERRED_LIGHTING_SHADER, /let Vis=0\.5\/\(gV\+gL\+1e-7\)/);

 geometry.dispose();basic.dispose();standard.dispose();
});

test('MeshStandardMaterial pure metal retains the punctual specular highlight', () => {
 const metalMat=new THREE.MeshStandardMaterial({color:0xffd700,metalness:1.0,roughness:0.1});
 const {pages,geometry}=quadPages(metalMat);
 const cam=camera(),size:[number,number]=[16,16];
 const ids=rasterVisibilityIds(pages,cam,size);
 const shaded=shadeVisibility(ids,pages,cam,size);
 const o=(((16/2)|0)*16+((16/2)|0))*4;
 // The directional source still contributes a tinted specular highlight.
 assert.ok(shaded[o] > 0);
 assert.ok(shaded[o+1] > 0);
 geometry.dispose();metalMat.dispose();
});

test('vis shader instances pages from the page table', () => {
  assert.match(VIS_SHADER, /@builtin\(instance_index\)/);
  assert.match(VIS_SHADER, /pages\s*:\s*array<PageInfo>/);
  assert.match(VIS_SHADER, /vertexIndex\s*>=\s*page\.indexCount/);
  assert.doesNotMatch(VIS_SHADER, /uni\.pageOffset/);
  assert.match(VIS_SHADER, /@group\(0\) @binding\(2\) var<storage,\s*read> pages/);
  assert.match(VIS_SHADER, /@group\(0\) @binding\(4\) var<uniform> uni/);
  assert.match(VIS_SHADER, /@group\(0\) @binding\(6\) var maps/);
  assert.match(VIS_SHADER, /fn maskKeep/);
  assert.match(VIS_SHADER, /discard;/);
  assert.match(VIS_SHADER, /textureSampleLevel/);
  assert.doesNotMatch(VIS_SHADER, /textureSample\s*\(/);
  assert.doesNotMatch(VIS_SHADER, /@group\(0\) @binding\(2\) var<uniform>/);
});

test('MASK alpha-test punches a visbuffer hole before shading', () => {
  const map=new THREE.DataTexture(new Uint8Array([255,0,0,255, 0,255,0,0, 0,0,255,0, 255,255,0,0]),2,2,THREE.RGBAFormat);
  map.magFilter=THREE.NearestFilter;map.minFilter=THREE.NearestFilter;map.flipY=false;map.needsUpdate=true;
  const mask=new THREE.MeshBasicMaterial({color:0xffffff,map,alphaTest:0.5});
  const solid=new THREE.MeshBasicMaterial({color:0x00ff00});
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([
   -1,-1,0,1,-1,0,1,1,0,-1,1,0,
   -1,-1,1,1,-1,1,1,1,1,-1,1,1,
  ],3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0.75,0.75,0.75,0.75,0.75,0.75,0.75,0.75, 0,0,1,0,1,1,0,1],2));
  const far:VisPage={array:new Uint32Array([0,1,2,0,2,3]),attributes:geometry.attributes,matrix:new THREE.Matrix4(),material:solid,clusterId:'far'};
  const near:VisPage={array:new Uint32Array([4,5,6,4,6,7]),attributes:geometry.attributes,matrix:new THREE.Matrix4(),material:mask,clusterId:'near'};
  const cam=camera(),ids=rasterVisibilityIds([far,near],cam,[16,16]);
  const unpacked=unpackVisibilityId(centerId(ids,16,16));
  assert.ok(unpacked);
  assert.equal(unpacked.pageIndex,0);
  assert.notEqual(unpacked.pageIndex,1);
  geometry.dispose();mask.dispose();solid.dispose();map.dispose();
});

test('standard-material irradiance matches the Three.js linear capture without an invented environment',()=>{
 // Captured from Three r174 on the same quad/lights, before display tone mapping.
 for(const [color,metalness,roughness,expected] of [
  [0xffffff,0,1,[227,228,229]], [0x808080,0,1,[115,115,116]],
  [0x808080,1,.5,[52,52,52]], [0x993322,0,.5,[137,50,37]],
 ] as const){
  const material=new THREE.MeshStandardMaterial({color,metalness,roughness});
  const {pages,geometry}=quadPages(material);const cam=camera();cam.position.z=3;cam.updateMatrixWorld();
  const size:[number,number]=[64,64],ids=rasterVisibilityIds(pages,cam,size);
  const pixels=shadeVisibility(ids,pages,cam,size),offset=(32*64+32)*4;
  for(let c=0;c<3;c++)assert.ok(Math.abs(pixels[offset+c]-expected[c])<=2,`color ${color}, metal ${metalness}, channel ${c}: ${pixels[offset+c]} vs ${expected[c]}`);
  geometry.dispose();material.dispose();
 }
});
