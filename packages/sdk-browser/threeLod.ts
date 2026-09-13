import {installSceneLighting} from './sceneLighting.ts';
import * as THREE from 'three';
import type {BackendFactory,BackendContext} from './backendTypes.ts';
import type {Page,Tree} from '../sdk-core/index.ts';
import {createTriangleDiagnosticMaterial,disposeTriangleGeometry,materialSide,triangleGeometry,triangleSalt} from './triangleDiagnostic.ts';
import {isTransmissive} from './visibilityBuffer.ts';

function meshes(source:THREE.Object3D){const found:THREE.Mesh[]=[];source.updateMatrixWorld(true);source.traverse(o=>{if((o as THREE.Mesh).isMesh)found.push(o as THREE.Mesh);});return found;}
function geometryBytes(geometry:THREE.BufferGeometry,seen:Set<ArrayBufferView>){let bytes=0;const index=geometry.getIndex();if(index&&!seen.has(index.array)){seen.add(index.array);bytes+=index.array.byteLength;}for(const name in geometry.attributes){const attr=geometry.attributes[name];if(!attr||seen.has(attr.array))continue;seen.add(attr.array);bytes+=attr.array.byteLength;}return bytes;}
function collectCover(node:Tree|null,pages:Page[],out:number[]){if(!node)return;if(node.coarsePages?.length){for(const id of node.coarsePages)if(pages[id])out.push(id);return;}if(node.page!==undefined){out.push(node.page);return;}if(node.children)for(const child of node.children)collectCover(child,pages,out);}
function buildIndex(pages:Page[],ids:number[],indices:Map<string,Uint32Array>){let count=0;for(const id of ids){const array=indices.get(pages[id].url);if(!array)return null;count+=array.length;}const out=new Uint32Array(count);let offset=0;for(const id of ids){const array=indices.get(pages[id].url)!;out.set(array,offset);offset+=array.length;}return out;}

/** Distance-based THREE.LOD from the same source meshes. Coarse levels exist only when QEM pages are present and loaded. */
export const threeLodBackend:BackendFactory=(context)=>{
 const scene=new THREE.Scene();
 const sceneLights=installSceneLighting(scene,context.sceneLighting??context.source,context.clearColor??0x171d28);
 const lods:THREE.LOD[]=[];
 let levels=1,allocationBytes=0,selectedTriangles=0,lodLevel=0,overBudget=false;
 const overlays:THREE.Material[]=[];
 const seen=new Set<ArrayBufferView>();
 let order=0;
 for(const mesh of meshes(context.source)){
  const association=context.associations.get(mesh);
  const primitive=context.metadata.primitives.find(p=>p.mesh===association?.meshes&&p.primitive===(association?.primitives??0));
  const lod=new THREE.LOD();lod.matrixAutoUpdate=false;lod.matrix.copy(mesh.matrixWorld);
  const fine=new THREE.Mesh(mesh.geometry,mesh.material);fine.matrixAutoUpdate=false;fine.matrix.identity();fine.renderOrder=order;fine.frustumCulled=true;fine.userData.sourceGeometry=mesh.geometry;fine.userData.sourceMaterial=mesh.material;
  lod.addLevel(fine,0);allocationBytes+=geometryBytes(mesh.geometry,seen);
  if(primitive?.hierarchy&&primitive.pass!=='shared-blend'&&!isTransmissive(mesh.material)){
   const coarseIds:number[]=[];collectCover(primitive.hierarchy,primitive.pages,coarseIds);
   const index=buildIndex(primitive.pages,coarseIds,context.indices);
   if(index&&index.length>=3){
    const geometry=new THREE.BufferGeometry();geometry.attributes={...mesh.geometry.attributes};geometry.setIndex(new THREE.BufferAttribute(index,1));
    const box=new THREE.Box3();if(primitive.hierarchy.min&&primitive.hierarchy.max){box.min.fromArray(primitive.hierarchy.min);box.max.fromArray(primitive.hierarchy.max);geometry.boundingBox=box.clone();geometry.boundingSphere=new THREE.Sphere();box.getBoundingSphere(geometry.boundingSphere);}
    const coarse=new THREE.Mesh(geometry,mesh.material);coarse.matrixAutoUpdate=false;coarse.matrix.identity();coarse.renderOrder=order;coarse.userData.lodLevel=1;coarse.userData.sourceGeometry=geometry;coarse.userData.sourceMaterial=mesh.material;
    const radius=geometry.boundingSphere?.radius||mesh.geometry.boundingSphere?.radius||1;
    lod.addLevel(coarse,Math.max(radius*2,1));levels=Math.max(levels,2);allocationBytes+=index.byteLength;
   }
  }
  scene.add(lod);lods.push(lod);order++;
 }
 return {
  id:'three-lod',
  capabilities:{renderer:'Three.js WebGL2 THREE.LOD',materials:'Converted glTF PBR, textures, alpha and double-sided flags preserved; no shadow map',hierarchy:levels>1,gpuDriven:false,simplification:levels>1,eviction:false,unsupported:levels>1?['GPU-driven selection/indirect draw','occlusion culling','bounded GPU eviction','physical VRAM instrumentation']:['general mesh LOD simplification','GPU-driven selection/indirect draw','occlusion culling','bounded GPU eviction','physical VRAM instrumentation']},
  get overBudget(){return overBudget;},scene,
  setDiagnostic(mode){overlays.splice(0).forEach(m=>m.dispose());for(const lod of lods)for(const level of lod.levels){const mesh=level.object as THREE.Mesh;const sourceGeometry=mesh.userData.sourceGeometry as THREE.BufferGeometry;const sourceMaterial=mesh.userData.sourceMaterial as THREE.Material|THREE.Material[];mesh.geometry=sourceGeometry;mesh.material=sourceMaterial;if(mode==='wireframe'){mesh.geometry=triangleGeometry(sourceGeometry,triangleSalt(String(mesh.id)));const material=createTriangleDiagnosticMaterial(materialSide(sourceMaterial));overlays.push(material);mesh.material=material;}}},
  async prepare(){},
  refreshSceneLighting:()=>sceneLights.refresh(),
  render(camera){sceneLights.update();camera.updateMatrixWorld();selectedTriangles=0;lodLevel=0;overBudget=false;
   for(const lod of lods){lod.update(camera);const current=lod.getCurrentLevel();lodLevel=Math.max(lodLevel,current);const object=lod.levels[current]?.object as THREE.Mesh|undefined;if(!object)continue;const index=object.geometry.getIndex();selectedTriangles+=(index?index.count:object.geometry.getAttribute('position').count)/3;}},
  metrics(){return {clusters:lods.length,selectedTriangles,residentPages:lods.length,geometryAllocationBytes:allocationBytes,pageEvictions:0,frustumRejected:0,lodLevel,submittedTriangles:selectedTriangles,drawCalls:lods.length};},
  dispose(){overlays.forEach(m=>m.dispose());for(const lod of lods){for(const level of lod.levels){const mesh=level.object as THREE.Mesh;const sourceGeometry=mesh.userData.sourceGeometry as THREE.BufferGeometry|undefined;if(sourceGeometry)disposeTriangleGeometry(sourceGeometry);if(mesh.geometry&&mesh.geometry!==(lod.levels[0]?.object as THREE.Mesh|undefined)?.geometry){for(const name of Object.keys(mesh.geometry.attributes))mesh.geometry.deleteAttribute(name);mesh.geometry.setIndex(null);mesh.geometry.dispose();}}lod.clear();}scene.clear();},
 };
};
