import type {BackendCapabilities,BackendFactory,RenderBackend} from './backendTypes.ts';
import {createGpuPageCache,type ResidentPage} from './gpuPages.ts';
import {collectClusterPages,collectPendingUrls,indexPagesByUrl,resolvePixelError,selectVisiblePages,trimToBudget,type PageRec} from './pageSelection.ts';
import {cameraSelectionUniforms,createGpuSelection,packSelectionForest,sameSelectionUniforms,type GpuSelection,type PackedForest,type SelectionResult,type SelectionUniforms} from './gpuSelection.ts';
import {OPEN_CONE,triangleCone} from './pageCone.ts';
import {RASTER_BACKGROUND} from './pageRaster.ts';
import {applyHiz,projectBoxToScreen,splitOccluders} from './hiz.ts';
import {createGpuHiz,type GpuHiz} from './gpuHiz.ts';
import {FLAG_DOUBLE,FLAG_HAS_MAP,FLAG_HAS_NORMAL,FLAG_HAS_UV,FLAG_LIT,FLAG_WRAP_S_REPEAT,FLAG_WRAP_T_REPEAT,PAGE_INFO_STRIDE,SHADE_SHADER,VIS_SHADER,clusterHash,rasterVisibilityIds,shadeVisibility,textureRgba,visMaterial} from './visibilityBuffer.ts';
import type {DiagnosticMode} from '../sdk-core/index.ts';
import * as THREE from 'three';

const SHADER=`struct Uniforms{viewProj:mat4x4f,world:mat4x4f,color:vec4f,pageOffset:u32,indexCount:u32,mode:u32,pad1:u32,}
@group(0) @binding(0) var<storage, read> indices:array<u32>;
@group(0) @binding(1) var<storage, read> positions:array<f32>;
@group(0) @binding(2) var<uniform> uni:Uniforms;
struct VSOut{@builtin(position) position:vec4f,@location(0) color:vec4f,@location(1) bary:vec3f,@location(2) view:vec3f,@location(3) @interpolate(flat) tri:u32,}
@vertex fn vs(@builtin(vertex_index) vertexIndex:u32)->VSOut{
 var out:VSOut;
 if(vertexIndex>=uni.indexCount){out.position=vec4f(0.0,0.0,0.0,1.0);out.color=vec4f(0.0);out.bary=vec3f(0.0);out.view=vec3f(0.0);out.tri=0u;return out;}
 let id=indices[uni.pageOffset+vertexIndex];
 let world=uni.world*vec4f(positions[id*3u],positions[id*3u+1u],positions[id*3u+2u],1.0);
 out.position=uni.viewProj*world;out.view=world.xyz;out.color=uni.color;out.tri=vertexIndex/3u+uni.pageOffset;
 let corner=vertexIndex%3u;
 out.bary=select(select(vec3f(0.0,0.0,1.0),vec3f(0.0,1.0,0.0),corner==1u),vec3f(1.0,0.0,0.0),corner==0u);
 return out;
}
fn aces(color:vec3f)->vec3f{
 var c=color/0.6;
 c=mat3x3f(vec3f(0.59719,0.07600,0.02840),vec3f(0.35458,0.90834,0.13383),vec3f(0.04823,0.01566,0.83777))*c;
 let a=c*(c+0.0245786)-0.000090537;let b=c*(0.983729*c+0.4329510)+0.238081;c=a/b;
 c=mat3x3f(vec3f(1.60475,-0.10208,-0.00327),vec3f(-0.53108,1.10813,-0.07276),vec3f(-0.07367,-0.00605,1.07602))*c;
 return clamp(c,vec3f(0.0),vec3f(1.0));
}
fn linearToSrgb(c:vec3f)->vec3f{return select(1.055*pow(c,vec3f(0.41666))-0.055,c*12.92,c<vec3f(0.0031308));}
fn hashColor(id:u32)->vec3f{let x=f32(id);return fract(sin(vec3f(x,x*1.37,x*2.17)*vec3f(12.9898,78.233,45.164))*43758.5453);}
@fragment fn fs(in:VSOut)->@location(0) vec4f{
 if(uni.mode==1u){
  let n=normalize(cross(dpdx(in.view),dpdy(in.view)));
  let wrap=0.28+0.72*max(0.0,abs(n.z));
  let width=fwidth(in.bary);
  let edge=1.0-min(min(smoothstep(0.0,width.x*1.2,in.bary.x),smoothstep(0.0,width.y*1.2,in.bary.y)),smoothstep(0.0,width.z*1.2,in.bary.z));
  return vec4f(mix(hashColor(in.tri)*wrap,vec3f(0.04,0.05,0.07),edge),1.0);
 }
 return vec4f(linearToSrgb(aces(in.color.xyz)),1.0);
}
`;

const viewProj=new THREE.Matrix4(),remap=new THREE.Matrix4().set(1,0,0,0,0,1,0,0,0,0,0.5,0.5,0,0,0,1),colorScratch=new THREE.Color();
const PAGES_GREEN:[number,number,number]=[0.204,0.827,0.6];

function lighting(scene:THREE.Scene){
 scene.background=new THREE.Color(RASTER_BACKGROUND);
 scene.add(new THREE.HemisphereLight(0xffffff,0x495061,2));
 const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(1,3,2);scene.add(light);
}
function linearColor(material:THREE.Material|THREE.Material[]):[number,number,number]{
 const first=Array.isArray(material)?material[0]:material;
 const color=(first as THREE.MeshBasicMaterial).color;
 if(!color)return [1,1,1];
 colorScratch.copy(color);if(THREE.ColorManagement.enabled)colorScratch.convertSRGBToLinear();
 return [colorScratch.r,colorScratch.g,colorScratch.b];
}
function clusterRgb(id:string):[number,number,number]{
 let hash=0;for(let i=0;i<id.length;i++)hash=(Math.imul(hash,31)+id.charCodeAt(i))>>>0;
 colorScratch.setHSL((hash*.61803398875)%1,.75,.55);
 if(THREE.ColorManagement.enabled)colorScratch.convertSRGBToLinear();
 return [colorScratch.r,colorScratch.g,colorScratch.b];
}
function materialSide(material:THREE.Material|THREE.Material[]){return Array.isArray(material)?material[0].side:material.side;}
function rowBytes(width:number){return Math.ceil(width*4/256)*256;}

export type WebgpuPagesBackend=RenderBackend&{flush():Promise<void>;rasterRgba():Uint8Array;selectedPageIds():string[];visibilityIds():Uint32Array};

function shownFromGpu(pages:PageRec[],result:SelectionResult,frame:number){
 const shown:PageRec[]=[];let selectedTriangles=0;
 for(const id of result.pageIds){const rec=pages[id];if(!rec)continue;rec.seen=frame;shown.push(rec);selectedTriangles+=rec.triangles;}
 return {shown,visible:shown.length,selectedTriangles,frustumRejected:result.frustumRejected,lodLevel:result.lodLevel};
}

/** WebGPU raster of Format 1 pages. GPU frustum + lodScore when compute is available; CPU selectVisiblePages remains the oracle and the silent fallback. */
export const webgpuPagesBackend:BackendFactory=(context)=>{
 const {source,metadata,indices,associations,maxResidentPages,viewport,gpuDevice}=context;
 const {roots,allPages,blendCopies,prepared}=collectClusterPages(source,metadata,indices,associations);
 const byUrl=indexPagesByUrl(allPages),pendingScratch:string[]=[],urlScratch:string[]=[],readyScratch:PageRec[]=[];
 const cap=maxResidentPages??Math.max(1024,prepared);
 const uniquePages=Math.max(1,new Set(allPages.map(page=>page.url)).size);
 const slots=Math.max(1,Math.min(cap,uniquePages));
 const scene=new THREE.Scene();lighting(scene);for(const copy of blendCopies)scene.add(copy);
 const pageBytes=Math.max(4,...allPages.map(page=>{const n=page.array?.byteLength??page.indexBytes;return n+(n%4?4-n%4:0);}));
 const sourceBytes=new Map(allPages.flatMap(page=>page.array?[[page.url,new Uint8Array(page.array.buffer,page.array.byteOffset,page.array.byteLength)] as const]:[]));
 let cache:ReturnType<typeof createGpuPageCache>|undefined,bindGroupLayout:GPUBindGroupLayout|undefined;
 let pipelineBack:GPURenderPipeline|undefined,pipelineNone:GPURenderPipeline|undefined;
 let colorTexture:GPUTexture|undefined,depthTexture:GPUTexture|undefined,colorView:GPUTextureView|undefined,depthView:GPUTextureView|undefined;
 const positionBuffers=new Map<THREE.BufferGeometry['attributes'],GPUBuffer>(),positionIds=new WeakMap<GPUBuffer,number>();
 let nextPositionId=1;
 const UNIFORM_STRIDE=256,STAGING_COUNT=3;
 let uniformBuffer:GPUBuffer|undefined,uniformPacked=new Float32Array(UNIFORM_STRIDE/4);
 const bindGroups=new Map<number,GPUBindGroup>(),pins=new Set<string>(),clusterRgbCache=new Map<string,[number,number,number]>();
 const staging:Array<GPUBuffer|undefined>=[undefined,undefined,undefined];
 const stagingBusy=[false,false,false];
 let lost=false,overBudget=false,visible=0,selectedTriangles=0,submittedTriangles=0,frustumRejected=0,lodLevel=0,hizRejected=0,frame=0,stagingIndex=0,bytesPerRow=256;
 let diagnostic:DiagnosticMode='beauty';
 const motion:{last?:THREE.Vector3;lastMs?:number}={};
 let pending:Promise<unknown>=Promise.resolve(),shown:PageRec[]=[],drawn:PageRec[]=[],targetSize:[number,number]=[viewport?.[0]??1,viewport?.[1]??1];
 let gpuSelection:GpuSelection|undefined;
 let packedForest:PackedForest|undefined;
 const packedPages:PageRec[]=roots.flatMap(root=>root.pages);
 const selectionUniforms:SelectionUniforms={planes:new Float32Array(24),view:new Float32Array(16),pixelScale:[1,1],pixelError:0,near:0.1,cameraWorld:[0,0,0]};
 const untexturedMaterials='Untextured source color; double-sided when the material is';
 const visFeatures=['visibility buffer','textured PBR maps','occlusion culling'];
 const capabilities:BackendCapabilities={renderer:'WebGPU page raster',materials:untexturedMaterials,hierarchy:true,gpuDriven:false,simplification:false,eviction:true,unsupported:['indirect draw','occlusion culling','physical VRAM instrumentation','textured PBR maps','visibility buffer']};
 const dropGpuSelection=()=>{gpuSelection?.dispose();gpuSelection=undefined;capabilities.gpuDriven=false;};
 let visEnabled=false,visTexture:GPUTexture|undefined,visView:GPUTextureView|undefined;
 let visPipelineBack:GPURenderPipeline|undefined,visPipelineNone:GPURenderPipeline|undefined,visPipelineFront:GPURenderPipeline|undefined,shadePipeline:GPURenderPipeline|undefined;
 let gpuHiz:GpuHiz|undefined,visHizBindGroupLayout:GPUBindGroupLayout|undefined;
 let visHizRestBack:GPURenderPipeline|undefined,visHizRestNone:GPURenderPipeline|undefined,visHizRestFront:GPURenderPipeline|undefined;
 const visHizBindGroups=new Map<number,GPUBindGroup>();
 let shadeBindGroupLayout:GPUBindGroupLayout|undefined,shadeBindGroup:GPUBindGroup|undefined;
 let concatPos:GPUBuffer|undefined,concatUv:GPUBuffer|undefined,concatNrm:GPUBuffer|undefined,pageTable:GPUBuffer|undefined,shadeUniform:GPUBuffer|undefined,mapsTexture:GPUTexture|undefined,mapsSampler:GPUSampler|undefined;
 const shadeUniPacked=new Float32Array(64),geometryBlocks=new Map<THREE.BufferGeometry['attributes'],{vertexBase:number;count:number;hasUv:boolean;hasNormal:boolean}>(),mapLayer=new Map<THREE.Texture,number>();
 const uvScales:Array<[number,number]>=[[1,1]];
 const dropGpuHiz=()=>{
  gpuHiz?.dispose();gpuHiz=undefined;visHizBindGroupLayout=undefined;
  visHizRestBack=undefined;visHizRestNone=undefined;visHizRestFront=undefined;visHizBindGroups.clear();
 };
 const dropVis=()=>{
  visEnabled=false;visPipelineBack=undefined;visPipelineNone=undefined;visPipelineFront=undefined;shadePipeline=undefined;shadeBindGroup=undefined;shadeBindGroupLayout=undefined;mapsSampler=undefined;
  dropGpuHiz();
  concatPos?.destroy();concatUv?.destroy();concatNrm?.destroy();pageTable?.destroy();shadeUniform?.destroy();mapsTexture?.destroy();
  concatPos=concatUv=concatNrm=pageTable=shadeUniform=mapsTexture=undefined;
  capabilities.materials=untexturedMaterials;
  for(const item of visFeatures)if(!capabilities.unsupported.includes(item))capabilities.unsupported.push(item);
 };
 let blitPixels=new Uint8Array(4);
 let blitTexture=new THREE.DataTexture(blitPixels,1,1,THREE.RGBAFormat);blitTexture.needsUpdate=true;blitTexture.colorSpace=THREE.SRGBColorSpace;blitTexture.flipY=false;
 const blitMaterial=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,uniforms:{image:{value:blitTexture}},vertexShader:'in vec3 position;void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:'precision highp float;uniform sampler2D image;out vec4 outColor;void main(){outColor=texelFetch(image,ivec2(gl_FragCoord.xy),0);}',depthTest:false,depthWrite:false,toneMapped:false});
 const blit=new THREE.Mesh(new THREE.PlaneGeometry(2,2),blitMaterial);blit.frustumCulled=false;blit.renderOrder=-1;blit.userData.blit=true;scene.add(blit);
 const pageSource={read:async(key:string)=>{const bytes=sourceBytes.get(key);if(!bytes)throw new Error('Missing page');return bytes;}};
 let lastCamera:THREE.PerspectiveCamera|undefined;
 const pageRgb=(rec:PageRec):[number,number,number]=>{
  if(diagnostic==='beauty')return linearColor(rec.material);
  if(diagnostic==='pages')return PAGES_GREEN;
  let rgb=clusterRgbCache.get(rec.clusterId);if(!rgb){rgb=clusterRgb(rec.clusterId);clusterRgbCache.set(rec.clusterId,rgb);}return rgb;
 };
 const ensureBlit=(width:number,height:number)=>{
  if(blitTexture.image.width===width&&blitTexture.image.height===height)return;
  blitTexture.dispose();
  blitPixels=new Uint8Array(width*height*4);
  blitTexture=new THREE.DataTexture(blitPixels,width,height,THREE.RGBAFormat);blitTexture.needsUpdate=true;blitTexture.colorSpace=THREE.SRGBColorSpace;blitTexture.flipY=false;
  blitMaterial.uniforms.image.value=blitTexture;
 };
 const destroyStaging=()=>{for(let i=0;i<staging.length;i++){staging[i]?.destroy();staging[i]=undefined;stagingBusy[i]=false;}};
 const ensureTargets=(device:GPUDevice,width:number,height:number)=>{
  if(colorTexture&&targetSize[0]===width&&targetSize[1]===height&&(!visEnabled||visTexture)&&(!gpuHiz||gpuHiz.width===width&&gpuHiz.height===height))return;
  colorTexture?.destroy();depthTexture?.destroy();visTexture?.destroy();visTexture=undefined;visView=undefined;shadeBindGroup=undefined;destroyStaging();
  colorTexture=device.createTexture({size:{width,height},format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  depthTexture=device.createTexture({size:{width,height},format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
  colorView=colorTexture.createView();depthView=depthTexture.createView();targetSize=[width,height];
  try{
   visTexture=device.createTexture({size:{width,height},format:'r32uint',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
   visView=visTexture.createView();
  }catch{visTexture=undefined;visView=undefined;}
  if(gpuHiz&&!gpuHiz.resize(device,width,height))dropGpuHiz();
  bytesPerRow=rowBytes(width);const stagingBytes=bytesPerRow*height;
  for(let i=0;i<STAGING_COUNT;i++){stagingBusy[i]=false;staging[i]=device.createBuffer({size:stagingBytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});}
  ensureBlit(width,height);
 };
 const pipelineFor=(rec:PageRec)=>materialSide(rec.material)===THREE.DoubleSide?pipelineNone:pipelineBack;
 const visPipelineFor=(rec:PageRec,rest:boolean)=>{
  const side=materialSide(rec.material);
  if(rest)return side===THREE.DoubleSide?visHizRestNone:side===THREE.BackSide?visHizRestFront:visHizRestBack;
  return side===THREE.DoubleSide?visPipelineNone:side===THREE.BackSide?visPipelineFront:visPipelineBack;
 };
 const bindGroupFor=(device:GPUDevice,position:GPUBuffer)=>{
  let id=positionIds.get(position);if(!id){id=nextPositionId++;positionIds.set(position,id);}
  let group=bindGroups.get(id);
  if(!group&&bindGroupLayout&&cache&&uniformBuffer){
   group=device.createBindGroup({layout:bindGroupLayout,entries:[{binding:0,resource:{buffer:cache.buffer}},{binding:1,resource:{buffer:position}},{binding:2,resource:{buffer:uniformBuffer,size:UNIFORM_STRIDE}}]});
   bindGroups.set(id,group);
  }
  return group;
 };
 const visHizBindGroupFor=(device:GPUDevice,position:GPUBuffer)=>{
  let id=positionIds.get(position);if(!id){id=nextPositionId++;positionIds.set(position,id);}
  let group=visHizBindGroups.get(id);
  if(!group&&visHizBindGroupLayout&&cache&&uniformBuffer&&gpuHiz){
   group=device.createBindGroup({layout:visHizBindGroupLayout,entries:[
    {binding:0,resource:{buffer:cache.buffer}},{binding:1,resource:{buffer:position}},
    {binding:2,resource:{buffer:uniformBuffer,size:UNIFORM_STRIDE}},{binding:3,resource:{buffer:gpuHiz.flags}},
   ]});
   visHizBindGroups.set(id,group);
  }
  return group;
 };
 const ensureUniform=(device:GPUDevice,draws:number)=>{
  const bytes=Math.max(1,draws,cap)*UNIFORM_STRIDE;
  if(!uniformBuffer||uniformBuffer.size<bytes){
   uniformBuffer?.destroy();bindGroups.clear();visHizBindGroups.clear();
   uniformBuffer=device.createBuffer({size:bytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  }
  if(uniformPacked.byteLength<bytes)uniformPacked=new Float32Array(bytes/4);
 };
 const copyFlipped=(src:Uint8Array,width:number,height:number,stride:number)=>{
  if((src.byteOffset&3)===0&&(stride&3)===0){
   const src32=new Uint32Array(src.buffer,src.byteOffset,src.byteLength>>2),dst32=new Uint32Array(blitPixels.buffer,blitPixels.byteOffset,width*height),stride32=stride>>2;
   for(let y=0;y<height;y++){let s=y*stride32,d=(height-1-y)*width;for(let x=0;x<width;x++)dst32[d++]=src32[s++];}
   return;
  }
  const row=width*4;for(let y=0;y<height;y++){const srcOff=y*stride,dstOff=(height-1-y)*row;for(let i=0;i<row;i++)blitPixels[dstOff+i]=src[srcOff+i];}
 };
  const readback=async(device:GPUDevice,index:number,buffer:GPUBuffer,w:number,h:number,stride:number)=>{
   if(!buffer||typeof buffer.mapAsync!=='function'){stagingBusy[index]=false;return;}
   try{
    await buffer.mapAsync(GPUMapMode.READ);
    if(blitPixels.byteLength===w*h*4&&blitTexture.image.width===w&&blitTexture.image.height===h){
     copyFlipped(new Uint8Array(buffer.getMappedRange()),w,h,stride);
     blitTexture.needsUpdate=true;
    }
    buffer.unmap();
   }catch{if(typeof buffer.unmap==='function')try{buffer.unmap();}catch{/* Mapping may already be closed. */}}
   finally{stagingBusy[index]=false;}
  };
  const packedDraws=()=>{
   const packed:Array<{rec:PageRec;resident:ResidentPage;index:Uint32Array;position:GPUBuffer}>=[];
   if(!cache)return packed;
   for(let i=0;i<drawn.length;i++){
    const rec=drawn[i],resident=cache.get(rec.url),index=rec.array;if(!resident||!index)continue;
    const position=positionBuffers.get(rec.attributes);if(!position)continue;
    packed.push({rec,resident,index,position});
   }
   return packed;
  };
  const submitColorCopy=(device:GPUDevice,encoder:GPUCommandEncoder,height:number,width:number)=>{
   let destIndex=-1;
   for(let k=0;k<STAGING_COUNT;k++){const idx=(stagingIndex+k)%STAGING_COUNT;if(staging[idx]&&!stagingBusy[idx]){destIndex=idx;break;}}
   const copyBuffer=destIndex>=0?staging[destIndex]:undefined;
   if(copyBuffer&&colorTexture)encoder.copyTextureToBuffer({texture:colorTexture},{buffer:copyBuffer,bytesPerRow,rowsPerImage:height},{width,height,depthOrArrayLayers:1});
   device.queue.submit([encoder.finish()]);
   if(destIndex>=0&&copyBuffer){
    stagingBusy[destIndex]=true;
    stagingIndex=(destIndex+1)%STAGING_COUNT;
    const stride=bytesPerRow;
    pending=pending.catch(()=>{}).then(()=>readback(device,destIndex,copyBuffer,width,height,stride));
   }
  };
 const encodeVis=(device:GPUDevice,camera:THREE.PerspectiveCamera,packed:Array<{rec:PageRec;resident:ResidentPage;index:Uint32Array;position:GPUBuffer}>)=>{
  if(!bindGroupLayout||!cache||!colorView||!depthView||!visView||!visPipelineBack||!shadePipeline)return 0;
  const idsView=visView,depthTarget=depthView;
  const [width,height]=targetSize;
  ensureUniform(device,Math.max(1,packed.length));
  const packedInts=new Uint32Array(uniformPacked.buffer,uniformPacked.byteOffset,uniformPacked.length);
  const visCount=Math.min(packed.length,0xffff);
  let occluderPacked=packed,restPacked=packed.slice(0,0),twoPass=false;
  if(gpuHiz&&packed.length>=2){
   const split=splitOccluders(packed.map(item=>item.rec),camera,[width,height]);
   if(split.occluders.length&&split.rest.length){
    const occluderSet=new Set(split.occluders),restSet=new Set(split.rest);
    occluderPacked=packed.filter(item=>occluderSet.has(item.rec));
    restPacked=packed.filter(item=>restSet.has(item.rec));
    twoPass=!!(occluderPacked.length&&restPacked.length&&visHizRestBack);
   }
  }
  const restSlot=new Map<PageRec,number>();
  for(let i=0;i<restPacked.length;i++)restSlot.set(restPacked[i].rec,i);
  for(let i=0;i<visCount;i++){
   const item=packed[i],base=i*(UNIFORM_STRIDE/4);
   uniformPacked.set(viewProj.elements,base);uniformPacked.set(item.rec.matrix.elements,base+16);
   packedInts[base+32]=((i+1)<<16)>>>0;packedInts[base+33]=item.resident.offset/4;packedInts[base+34]=item.index.length;
   packedInts[base+35]=restSlot.has(item.rec)?restSlot.get(item.rec)!:0xffffffff;
  }
  if(packed.length&&uniformBuffer)device.queue.writeBuffer(uniformBuffer,0,uniformPacked.subarray(0,packed.length*(UNIFORM_STRIDE/4)));
  const tableBytes=Math.max(PAGE_INFO_STRIDE,packed.length*PAGE_INFO_STRIDE);
  if(!pageTable||pageTable.size<tableBytes){pageTable?.destroy();shadeBindGroup=undefined;pageTable=device.createBuffer({size:tableBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});}
  const pageFloats=new Float32Array(tableBytes/4),pageInts=new Uint32Array(pageFloats.buffer);
  for(let i=0;i<packed.length;i++){
   const item=packed[i],base=i*(PAGE_INFO_STRIDE/4),mat=visMaterial(item.rec.material),geo=geometryBlocks.get(item.rec.attributes);
   const layer=mat.map&&mapLayer.has(mat.map)?mapLayer.get(mat.map)!:0,scale=uvScales[layer]??[1,1];
   pageFloats.set(item.rec.matrix.elements,base);
   pageFloats[base+16]=mat.baseColor[0];pageFloats[base+17]=mat.baseColor[1];pageFloats[base+18]=mat.baseColor[2];pageFloats[base+19]=1;
   pageFloats[base+20]=mat.metalness;pageFloats[base+21]=mat.roughness;
   let flags=0;if(mat.lit)flags|=FLAG_LIT;if(mat.doubleSided)flags|=FLAG_DOUBLE;if(geo?.hasUv)flags|=FLAG_HAS_UV;if(layer)flags|=FLAG_HAS_MAP;if(geo?.hasNormal)flags|=FLAG_HAS_NORMAL;
   if(mat.map&&mat.map.wrapS!==THREE.ClampToEdgeWrapping)flags|=FLAG_WRAP_S_REPEAT;
   if(mat.map&&mat.map.wrapT!==THREE.ClampToEdgeWrapping)flags|=FLAG_WRAP_T_REPEAT;
   pageInts[base+22]=layer;pageInts[base+23]=flags;pageInts[base+24]=item.resident.offset/4;pageInts[base+25]=item.index.length;pageInts[base+26]=geo?.vertexBase??0;pageInts[base+27]=((i+1)<<16)>>>0;
   pageFloats[base+28]=scale[0];pageFloats[base+29]=scale[1];pageInts[base+30]=clusterHash(item.rec.clusterId);
  }
  device.queue.writeBuffer(pageTable,0,pageFloats);
  if(!shadeUniform)shadeUniform=device.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  shadeUniPacked.set(viewProj.elements,0);shadeUniPacked[16]=width;shadeUniPacked[17]=height;
  const shadeInts=new Uint32Array(shadeUniPacked.buffer);shadeInts[20]=packed.length;shadeInts[21]=diagnostic==='wireframe'?1:diagnostic==='pages'?3:diagnostic==='beauty'?0:2;
  shadeUniPacked[24]=camera.position.x;shadeUniPacked[25]=camera.position.y;shadeUniPacked[26]=camera.position.z;shadeUniPacked[27]=1;
  const lLen=Math.hypot(1,3,2);shadeUniPacked[28]=1/lLen;shadeUniPacked[29]=3/lLen;shadeUniPacked[30]=2/lLen;shadeUniPacked[31]=2.5;
  shadeUniPacked[32]=2;shadeUniPacked[33]=2;shadeUniPacked[34]=2;shadeUniPacked[35]=1;
  shadeUniPacked[36]=0x49/255*2;shadeUniPacked[37]=0x50/255*2;shadeUniPacked[38]=0x61/255*2;shadeUniPacked[39]=1;
  shadeUniPacked[40]=0x17/255;shadeUniPacked[41]=0x1d/255;shadeUniPacked[42]=0x28/255;shadeUniPacked[43]=1;
  device.queue.writeBuffer(shadeUniform,0,shadeUniPacked);
  if(!shadeBindGroup&&shadeBindGroupLayout&&visView&&pageTable&&concatPos&&concatUv&&concatNrm&&mapsTexture&&mapsSampler&&shadeUniform&&cache){
   shadeBindGroup=device.createBindGroup({layout:shadeBindGroupLayout,entries:[
    {binding:0,resource:visView},{binding:1,resource:{buffer:cache.buffer}},{binding:2,resource:{buffer:concatPos}},
    {binding:3,resource:{buffer:concatUv}},{binding:4,resource:{buffer:concatNrm}},{binding:5,resource:{buffer:pageTable}},
    {binding:6,resource:mapsTexture.createView({dimension:'2d-array'})},{binding:7,resource:mapsSampler},{binding:8,resource:{buffer:shadeUniform}},
   ]});
  }
  const encoder=device.createCommandEncoder();
  const visColors=(loadOp:'clear'|'load')=>{
   const ids:{view:GPUTextureView;loadOp:'clear'|'load';storeOp:'store';clearValue?:GPUColor}={view:idsView,loadOp,storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}};
   if(!gpuHiz)return [ids];
   return [ids,{view:gpuHiz.level0View,loadOp,storeOp:'store' as const,clearValue:{r:1,g:0,b:0,a:1}}];
  };
  const drawVis=(pass:GPURenderPassEncoder,items:typeof packed,rest:boolean)=>{
   let vertices=0;
   for(let i=0;i<packed.length;i++){
    const item=packed[i];if(!items.includes(item))continue;
    const group=rest?visHizBindGroupFor(device,item.position):bindGroupFor(device,item.position),pipeline=visPipelineFor(item.rec,rest);
    if(!group||!pipeline)continue;
    pass.setPipeline(pipeline);pass.setBindGroup(0,group,[i*UNIFORM_STRIDE]);pass.draw(item.index.length);vertices+=item.index.length;
   }
   return vertices;
  };
  const visPass=encoder.beginRenderPass({
   colorAttachments:visColors('clear'),
   depthStencilAttachment:{view:depthTarget,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'},
  });
  visPass.setViewport(0,0,width,height,0,1);
  let vertices=drawVis(visPass,twoPass?occluderPacked:packed,false);
  visPass.end();
  if(twoPass&&gpuHiz){
   gpuHiz.encodePyramid(encoder);
   gpuHiz.encodeTest(device,encoder,restPacked.map(item=>projectBoxToScreen(item.rec.min,item.rec.max,item.rec.matrix,camera,[width,height])));
   const restPass=encoder.beginRenderPass({
    colorAttachments:visColors('load'),
    depthStencilAttachment:{view:depthTarget,depthLoadOp:'load',depthStoreOp:'store'},
   });
   restPass.setViewport(0,0,width,height,0,1);
   vertices+=drawVis(restPass,restPacked,true);
   restPass.end();
  }
  const shadePass=encoder.beginRenderPass({colorAttachments:[{view:colorView,loadOp:'clear',storeOp:'store',clearValue:{r:0x17/255,g:0x1d/255,b:0x28/255,a:1}}]});
  shadePass.setViewport(0,0,width,height,0,1);
  if(shadeBindGroup){shadePass.setPipeline(shadePipeline);shadePass.setBindGroup(0,shadeBindGroup);shadePass.draw(3);}
  shadePass.end();
  submitColorCopy(device,encoder,height,width);
  return vertices/3;
 };
 const encodeDraws=(device:GPUDevice,camera:THREE.PerspectiveCamera)=>{
  if(!bindGroupLayout||!cache||!colorView||!depthView)return 0;
  const [width,height]=targetSize;
  viewProj.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);viewProj.premultiply(remap);
  const packed=packedDraws();
  if(visEnabled&&visPipelineBack&&shadePipeline&&visView){
   try{return encodeVis(device,camera,packed);}catch{dropVis();}
  }
  if(!pipelineBack)return 0;
  ensureUniform(device,Math.max(1,packed.length));
  const packedInts=new Uint32Array(uniformPacked.buffer,uniformPacked.byteOffset,uniformPacked.length);
  for(let i=0;i<packed.length;i++){
   const item=packed[i],base=i*(UNIFORM_STRIDE/4),color=pageRgb(item.rec);
   uniformPacked.set(viewProj.elements,base);uniformPacked.set(item.rec.matrix.elements,base+16);
   uniformPacked[base+32]=color[0];uniformPacked[base+33]=color[1];uniformPacked[base+34]=color[2];uniformPacked[base+35]=1;
   packedInts[base+36]=item.resident.offset/4;packedInts[base+37]=item.index.length;packedInts[base+38]=diagnostic==='wireframe'?1:0;
  }
  if(packed.length&&uniformBuffer)device.queue.writeBuffer(uniformBuffer,0,uniformPacked.subarray(0,packed.length*(UNIFORM_STRIDE/4)));
  const encoder=device.createCommandEncoder();
  const pass=encoder.beginRenderPass({
   colorAttachments:[{view:colorView,loadOp:'clear',storeOp:'store',clearValue:{r:0.07,g:0.09,b:0.13,a:1}}],
   depthStencilAttachment:{view:depthView,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'},
  });
  pass.setViewport(0,0,width,height,0,1);
  let vertices=0;
  for(let i=0;i<packed.length;i++){
   const item=packed[i],group=bindGroupFor(device,item.position),pipeline=pipelineFor(item.rec);if(!group||!pipeline)continue;
   pass.setPipeline(pipeline);pass.setBindGroup(0,group,[i*UNIFORM_STRIDE]);pass.draw(item.index.length);vertices+=item.index.length;
  }
  pass.end();
  submitColorCopy(device,encoder,height,width);
  return vertices/3;
 };
 const hasBytes=(rec:PageRec)=>!!(rec.array||sourceBytes.has(rec.url));
 const ensureResident=async(wanted:PageRec[])=>{
  if(!cache)return;
  const wantedKeys=new Set<string>();
  for(const rec of wanted)if(hasBytes(rec))wantedKeys.add(rec.url);
  for(const key of pins)if(!wantedKeys.has(key)){cache.unpin(key);pins.delete(key);}
  const loads:Promise<void>[]=[];
  for(const rec of wanted){
   if(!wantedKeys.has(rec.url))continue;
   if(cache.get(rec.url)){cache.pin(rec.url);pins.add(rec.url);continue;}
   loads.push(cache.load(rec.url).then(()=>{cache!.pin(rec.url);pins.add(rec.url);}));
  }
  await Promise.all(loads);
 };
 const queueResident=(wanted:PageRec[])=>{
  pending=pending.catch(()=>{}).then(()=>ensureResident(wanted)).catch(error=>{
   const text=String(error);
   if(/LOST|DISPOSED/i.test(text)){lost=true;return;}
   throw error;
  });
 };
 const backend:WebgpuPagesBackend={
  id:'webgpu-page-raster',
  capabilities,
  scene,
  get overBudget(){return overBudget;},
  setDiagnostic(mode){diagnostic=mode;},
  async prepare(){
   if(!gpuDevice)throw new Error('WEBGPU_UNAVAILABLE');
   gpuDevice.lost.then(()=>{lost=true;}).catch(()=>{lost=true;});
   try{
    cache=createGpuPageCache(gpuDevice,pageSource,{pageBytes,slots});
    bindGroupLayout=gpuDevice.createBindGroupLayout({entries:[
     {binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
     {binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
     {binding:2,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform',hasDynamicOffset:true,minBindingSize:UNIFORM_STRIDE}},
    ]});
    const module=gpuDevice.createShaderModule({code:SHADER});
    const layout=gpuDevice.createPipelineLayout({bindGroupLayouts:[bindGroupLayout]});
    const fragment={module,entryPoint:'fs',targets:[{format:'rgba8unorm' as GPUTextureFormat}]};
    const depthStencil={format:'depth24plus' as GPUTextureFormat,depthWriteEnabled:true,depthCompare:'less' as GPUCompareFunction};
    pipelineBack=gpuDevice.createRenderPipeline({layout,vertex:{module,entryPoint:'vs'},fragment,primitive:{topology:'triangle-list',cullMode:'back',frontFace:'ccw'},depthStencil});
    pipelineNone=gpuDevice.createRenderPipeline({layout,vertex:{module,entryPoint:'vs'},fragment,primitive:{topology:'triangle-list',cullMode:'none',frontFace:'ccw'},depthStencil});
    for(const rec of allPages){
     if(positionBuffers.has(rec.attributes))continue;
     const array=rec.attributes.position?.array;if(!array)continue;
     const copy=new Uint8Array(array.byteLength);copy.set(new Uint8Array(array.buffer,array.byteOffset,array.byteLength));
     const buffer=gpuDevice.createBuffer({size:copy.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
     gpuDevice.queue.writeBuffer(buffer,0,copy.buffer);positionBuffers.set(rec.attributes,buffer);
    }
    const [width,height]=viewport??[1,1];ensureTargets(gpuDevice,Math.max(1,width),Math.max(1,height));
    ensureUniform(gpuDevice,cap);
    try{
     geometryBlocks.clear();mapLayer.clear();uvScales.length=0;uvScales.push([1,1]);
     let vertexCount=0;
     for(const rec of allPages){
      if(geometryBlocks.has(rec.attributes))continue;
      const n=rec.attributes.position?.count??0;
      geometryBlocks.set(rec.attributes,{vertexBase:vertexCount,count:n,hasUv:!!rec.attributes.uv,hasNormal:!!rec.attributes.normal});
      vertexCount+=n;
     }
     vertexCount=Math.max(1,vertexCount);
     const pos=new Float32Array(vertexCount*3),uv=new Float32Array(vertexCount*2),nrm=new Float32Array(vertexCount*3),filled=new Set<THREE.BufferGeometry['attributes']>();
     for(const rec of allPages){
      if(filled.has(rec.attributes))continue;filled.add(rec.attributes);
      const block=geometryBlocks.get(rec.attributes)!;const p=rec.attributes.position,u=rec.attributes.uv,n=rec.attributes.normal;
      for(let i=0;i<block.count;i++){
       const o=block.vertexBase+i;
       if(p){pos[o*3]=p.getX(i);pos[o*3+1]=p.getY(i);pos[o*3+2]=p.getZ(i);}
       if(u){uv[o*2]=u.getX(i);uv[o*2+1]=u.getY(i);}
       if(n){nrm[o*3]=n.getX(i);nrm[o*3+1]=n.getY(i);nrm[o*3+2]=n.getZ(i);}
      }
     }
     const upload=(data:Float32Array)=>{const buffer=gpuDevice.createBuffer({size:Math.max(4,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});gpuDevice.queue.writeBuffer(buffer,0,data.buffer as ArrayBuffer,data.byteOffset,data.byteLength);return buffer;};
     concatPos=upload(pos);concatUv=upload(uv);concatNrm=upload(nrm);
     const maps:THREE.Texture[]=[];
     for(const rec of allPages){const mat=visMaterial(rec.material);if(mat.map&&!mapLayer.has(mat.map)){mapLayer.set(mat.map,maps.length+1);maps.push(mat.map);}}
     let maxW=1,maxH=1;
     const rgbaMaps=maps.map(texture=>{const rgba=textureRgba(texture);if(rgba){maxW=Math.max(maxW,rgba.width);maxH=Math.max(maxH,rgba.height);}else{const image=texture.image as {width?:number;height?:number}|undefined;if(image?.width&&image.height){maxW=Math.max(maxW,image.width);maxH=Math.max(maxH,image.height);}}return rgba;});
     const layers=Math.max(2,maps.length+1);
     mapsTexture=gpuDevice.createTexture({size:{width:maxW,height:maxH,depthOrArrayLayers:layers},format:'rgba8unorm-srgb',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
     const white=new Uint8Array(maxW*maxH*4);white.fill(255);
     gpuDevice.queue.writeTexture({texture:mapsTexture,origin:[0,0,0]},white,{bytesPerRow:maxW*4,rowsPerImage:maxH},{width:maxW,height:maxH});
     for(let i=0;i<maps.length;i++){
      const rgba=rgbaMaps[i],layer=i+1;uvScales[layer]=[1,1];
      if(rgba){
       const padded=new Uint8Array(maxW*maxH*4);padded.fill(255);
       for(let y=0;y<rgba.height;y++)padded.set(rgba.data.subarray(y*rgba.width*4,(y+1)*rgba.width*4),y*maxW*4);
       gpuDevice.queue.writeTexture({texture:mapsTexture,origin:[0,0,layer]},padded,{bytesPerRow:maxW*4,rowsPerImage:maxH},{width:maxW,height:maxH});
       uvScales[layer]=[rgba.width/maxW,rgba.height/maxH];
      }else{
       const image=maps[i].image as GPUCopyExternalImageSource|undefined;
       if(image&&typeof gpuDevice.queue.copyExternalImageToTexture==='function'){
        try{
         const w='width' in image?(image as ImageBitmap).width:maxW,h='height' in image?(image as ImageBitmap).height:maxH;
         gpuDevice.queue.copyExternalImageToTexture({source:image},{texture:mapsTexture,origin:[0,0,layer]},[w,h]);
         uvScales[layer]=[w/maxW,h/maxH];
        }catch{/* Keep the white layer when the host image cannot be copied. */}
       }
      }
     }
     mapsSampler=gpuDevice.createSampler({magFilter:'linear',minFilter:'linear'});
     shadeUniform=gpuDevice.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
     const visModule=gpuDevice.createShaderModule({code:VIS_SHADER});
     const shadeModule=gpuDevice.createShaderModule({code:SHADE_SHADER});
     const visLayout=gpuDevice.createPipelineLayout({bindGroupLayouts:[bindGroupLayout]});
     const visDepth={format:'depth24plus' as GPUTextureFormat,depthWriteEnabled:true,depthCompare:'less' as GPUCompareFunction};
     const makeVis=(layout:GPUPipelineLayout,vertex:string,fragment:string,targets:GPUColorTargetState[],cull:GPUCullMode)=>gpuDevice.createRenderPipeline({layout,vertex:{module:visModule,entryPoint:vertex},fragment:{module:visModule,entryPoint:fragment,targets},primitive:{topology:'triangle-list',cullMode:cull,frontFace:'ccw'},depthStencil:visDepth});
     const oneTarget:GPUColorTargetState[]=[{format:'r32uint'}];
     gpuHiz=await createGpuHiz(gpuDevice,Math.max(1,width),Math.max(1,height),cap);
     try{
      if(!gpuHiz||!bindGroupLayout)throw new Error('HIZ_UNAVAILABLE');
      const twoTarget:GPUColorTargetState[]=[{format:'r32uint'},{format:'r32float'}];
      visPipelineBack=makeVis(visLayout,'vis_vs','vis_hiz_fs',twoTarget,'back');
      visPipelineNone=makeVis(visLayout,'vis_vs','vis_hiz_fs',twoTarget,'none');
      visPipelineFront=makeVis(visLayout,'vis_vs','vis_hiz_fs',twoTarget,'front');
      visHizBindGroupLayout=gpuDevice.createBindGroupLayout({entries:[
       {binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
       {binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
       {binding:2,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform',hasDynamicOffset:true,minBindingSize:UNIFORM_STRIDE}},
       {binding:3,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
      ]});
      const restLayout=gpuDevice.createPipelineLayout({bindGroupLayouts:[visHizBindGroupLayout]});
      visHizRestBack=makeVis(restLayout,'vis_hiz_vs','vis_hiz_fs',twoTarget,'back');
      visHizRestNone=makeVis(restLayout,'vis_hiz_vs','vis_hiz_fs',twoTarget,'none');
      visHizRestFront=makeVis(restLayout,'vis_hiz_vs','vis_hiz_fs',twoTarget,'front');
     }catch{
      dropGpuHiz();
      visPipelineBack=makeVis(visLayout,'vis_vs','vis_fs',oneTarget,'back');
      visPipelineNone=makeVis(visLayout,'vis_vs','vis_fs',oneTarget,'none');
      visPipelineFront=makeVis(visLayout,'vis_vs','vis_fs',oneTarget,'front');
     }
     shadeBindGroupLayout=gpuDevice.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'uint'}},
      {binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
      {binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
      {binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
      {binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
      {binding:5,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
      {binding:6,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d-array'}},
      {binding:7,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
      {binding:8,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform',minBindingSize:256}},
     ]});
     shadePipeline=gpuDevice.createRenderPipeline({
      layout:gpuDevice.createPipelineLayout({bindGroupLayouts:[shadeBindGroupLayout]}),
      vertex:{module:shadeModule,entryPoint:'shade_vs'},
      fragment:{module:shadeModule,entryPoint:'shade_fs',targets:[{format:'rgba8unorm' as GPUTextureFormat}]},
      primitive:{topology:'triangle-list',cullMode:'none'},
     });
     if(!pageTable)pageTable=gpuDevice.createBuffer({size:PAGE_INFO_STRIDE,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
     if(visView&&cache&&concatPos&&concatUv&&concatNrm&&mapsTexture&&mapsSampler&&shadeUniform&&shadeBindGroupLayout){
      shadeBindGroup=gpuDevice.createBindGroup({layout:shadeBindGroupLayout,entries:[
       {binding:0,resource:visView},{binding:1,resource:{buffer:cache.buffer}},{binding:2,resource:{buffer:concatPos}},
       {binding:3,resource:{buffer:concatUv}},{binding:4,resource:{buffer:concatNrm}},{binding:5,resource:{buffer:pageTable}},
       {binding:6,resource:mapsTexture.createView({dimension:'2d-array'})},{binding:7,resource:mapsSampler},{binding:8,resource:{buffer:shadeUniform}},
      ]});
     }
     visEnabled=!!visTexture&&!!shadeBindGroup;
     if(visEnabled){
      capabilities.materials='Source glTF via visbuffer second pass (baseColor, maps, metalness/roughness); not MeshStandardMaterial pixel-perfect';
      capabilities.unsupported=capabilities.unsupported.filter(item=>item!=='visibility buffer'&&item!=='textured PBR maps'&&item!=='occlusion culling');
     }else dropVis();
    }catch{dropVis();}
    for(const rec of allPages){
     const array=rec.array,position=rec.attributes.position?.array;
     if(!array||!position)continue;
     rec.cone=visMaterial(rec.material).doubleSided?OPEN_CONE:triangleCone(position,array);
    }
    const packed=packSelectionForest(roots);
    packedForest=packed;
    gpuSelection=await createGpuSelection(gpuDevice,packed);
    capabilities.gpuDriven=!!gpuSelection;
   }catch(error){
    if(String(error).includes('WEBGPU')||String(error).includes('INVALID_PAGE_BUDGET'))throw error;
    throw new Error('WEBGPU_UNAVAILABLE');
   }
  },
  render(camera){
   if(lost)throw new Error('WEBGPU_LOST');
   if(!gpuDevice||!cache)throw new Error('WEBGPU_UNAVAILABLE');
   lastCamera=camera;overBudget=false;submittedTriangles=0;hizRejected=0;frame++;
   const pixelError=resolvePixelError(context,camera,motion);
   let selected:{shown:PageRec[];visible:number;selectedTriangles:number;frustumRejected:number;lodLevel:number}|undefined;
   if(gpuSelection?.failed())dropGpuSelection();
   if(gpuSelection){
    cameraSelectionUniforms(camera,pixelError,viewport,selectionUniforms);
    try{gpuSelection.dispatch(selectionUniforms);}catch{dropGpuSelection();}
    const cut=gpuSelection?.peek();
    if(cut&&sameSelectionUniforms(cut.uniforms,selectionUniforms))selected=shownFromGpu(packedPages,cut.result,frame);
   }
   if(!selected)selected=selectVisiblePages(roots,camera,{pixelError,viewport,frame},shown);
   else{shown.length=0;shown.push(...selected.shown);}
   const trimmed=trimToBudget(shown,cap);
   overBudget=trimmed.overBudget;visible=trimmed.visible;selectedTriangles=trimmed.selectedTriangles;frustumRejected=selected.frustumRejected;lodLevel=selected.lodLevel;
   if(trimmed.shown!==shown){shown.length=0;shown.push(...trimmed.shown);}
   readyScratch.length=0;for(let i=0;i<shown.length;i++)if(hasBytes(shown[i]))readyScratch.push(shown[i]);
   let culled:PageRec[]=readyScratch;
   if(visEnabled&&!gpuHiz&&readyScratch.length>=2&&readyScratch.every(page=>page.array)){
    try{
     const cut=applyHiz(readyScratch as Array<PageRec&{array:Uint32Array}>,camera,viewport??targetSize);
     culled=cut.shown;hizRejected=cut.hizRejected;
    }catch{/* Keep the selected cut when this-frame Hi-Z cannot run. */}
   }
   queueResident(culled);
   drawn.length=0;for(let i=0;i<culled.length;i++)if(cache!.get(culled[i].url))drawn.push(culled[i]);
   if(!drawn.length){submittedTriangles=0;return;}
   const [width,height]=viewport??targetSize;ensureTargets(gpuDevice,Math.max(1,width),Math.max(1,height));
   submittedTriangles=encodeDraws(gpuDevice,camera);
  },
  syncResident(){
   if(lost||!gpuDevice||!cache||!lastCamera)return;
   readyScratch.length=0;for(let i=0;i<shown.length;i++)if(hasBytes(shown[i]))readyScratch.push(shown[i]);
   queueResident(readyScratch);
   drawn.length=0;for(let i=0;i<readyScratch.length;i++)if(cache.get(readyScratch[i].url))drawn.push(readyScratch[i]);
   if(!drawn.length){submittedTriangles=0;return;}
   const [width,height]=viewport??targetSize;ensureTargets(gpuDevice,Math.max(1,width),Math.max(1,height));
   submittedTriangles=encodeDraws(gpuDevice,lastCamera);
  },
  async flush(){
   await pending;
   if(gpuSelection){
    try{await gpuSelection.flush();if(gpuSelection.failed())dropGpuSelection();}
    catch{dropGpuSelection();}
   }
  },
  selectedPageIds(){return shown.map(rec=>rec.url);},
  visibilityIds(){
   const size=viewport??targetSize,pages=drawn.filter(rec=>rec.array).map(rec=>({...rec,array:rec.array!}));
   return rasterVisibilityIds(pages,lastCamera??new THREE.PerspectiveCamera(),size);
  },
  rasterRgba(){
   const size=viewport??targetSize,pages=drawn.filter(rec=>rec.array).map(rec=>({...rec,array:rec.array!})),cam=lastCamera??new THREE.PerspectiveCamera();
   return shadeVisibility(rasterVisibilityIds(pages,cam,size),pages,cam,size);
  },
  pendingUrls(){return collectPendingUrls(shown,pendingScratch);},
  pageUrls(){urlScratch.length=0;for(let i=0;i<shown.length;i++)urlScratch.push(shown[i].url);return urlScratch;},
  acceptPage(url,array){const recs=byUrl.get(url);if(!recs)return;for(let i=0;i<recs.length;i++){recs[i].array=array;recs[i].indexBytes=array.byteLength;}sourceBytes.set(url,new Uint8Array(array.buffer,array.byteOffset,array.byteLength));},
  metrics(){
   const stats=cache?.stats(),seen=new Set<ArrayBufferView>();
   let vertexBytes=0;
   for(const rec of drawn){const array=rec.attributes.position?.array;if(!array||seen.has(array))continue;seen.add(array);vertexBytes+=array.byteLength;}
   return {clusters:visible,selectedTriangles,residentPages:drawn.length,pageEvictions:stats?.evictions??0,geometryAllocationBytes:(stats?.allocatedBytes??0)+vertexBytes,frustumRejected,lodLevel,submittedTriangles,hizRejected:visEnabled?hizRejected:null};
  },
  dispose(){
   lost=true;pending=pending.catch(()=>{});dropGpuSelection();dropVis();
   visTexture?.destroy();visTexture=undefined;visView=undefined;
   for(const buffer of positionBuffers.values())buffer.destroy();
   uniformBuffer?.destroy();uniformBuffer=undefined;
   destroyStaging();colorTexture?.destroy();depthTexture?.destroy();
   blitTexture.dispose();blitMaterial.dispose();blit.geometry.dispose();
   const closing=cache?.dispose();cache=undefined;scene.clear();
   return closing;
  },
 };
 return backend;
};
