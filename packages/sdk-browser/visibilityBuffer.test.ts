import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from 'three';
import {compareImages} from '../sdk-core/index.ts';
import {rasterPages} from './pageRaster.ts';
import {packVisibilityId,unpackVisibilityId,rasterVisibilityIds,shadeVisibility,visibilityUvDerivatives,VIS_INVALID,type VisPage} from './visibilityBuffer.ts';

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

test('MeshStandardMaterial visbuffer lighting is the documented Lambert+Blinn model, not an unlit copy',()=>{
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
 geometry.dispose();basic.dispose();standard.dispose();
});
