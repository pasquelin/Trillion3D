import * as THREE from 'three';
import {collectClusterPages,indexPagesByUrl,resolvePixelError,selectVisiblePages,type PageRec} from './pageSelection.ts';
import {decodeGeometryPage,type DecodedGeometryPage} from './geometryPage.ts';
import {installSceneLighting} from './sceneLighting.ts';
import type {BackendFactory} from './backendTypes.ts';

/** WebGL2 path backed only by independently decoded prepared geometry pages. */
export const autonomousPagesBackend:BackendFactory=context=>{
 const metadata={...context.metadata,primitives:context.metadata.primitives.map(primitive=>({...primitive,pages:primitive.pages.map(page=>{
  if(!page.geometry||page.geometry.formatVersion!==2||page.geometry.codec!=='meshopt'||page.geometry.indexCount!==page.count)throw new Error('AUTONOMOUS_PAGE_MISSING');
  return {...page,url:page.geometry.url,bytes:page.geometry.bytes,sha256:page.geometry.sha256};
 })}))};
 const {roots,allPages}=collectClusterPages(context.source,metadata,new Map(),context.associations,{allowMissing:true});
 const bootstrap:PageRec[]=[];
 const cover=(node:typeof roots[number]['tree'],pages:PageRec[])=>{
  const ids=node.coarsePages?.length?node.coarsePages:node.page!==undefined?[node.page]:undefined;
  if(ids){for(const id of ids){const page=pages[id];if(!page)throw new Error('INVALID_ROOT_COVERAGE');bootstrap.push(page);}return;}
  if(!node.children?.length)throw new Error('INVALID_ROOT_COVERAGE');
  for(const child of node.children)cover(child,pages);
 };
 for(const root of roots)cover(root.tree,root.pages);
 const byUrl=indexPagesByUrl(allPages),bootstrapUrls=new Set(bootstrap.map(page=>page.url));
 const descriptors=new Map(context.metadata.primitives.flatMap(primitive=>primitive.pages).filter(page=>!!page.geometry).map(page=>[page.geometry!.url,page.geometry!] as const));
 const cap=context.maxResidentPages??Math.max(1024,bootstrapUrls.size),scene=new THREE.Scene();
 const lighting=installSceneLighting(scene,context.sceneLighting??context.source,context.clearColor??0x171d28);
 const shown:PageRec[]=[],desired:PageRec[]=[],pending:string[]=[],retained:string[]=[];
 const baseMaterials=new Map(allPages.map(rec=>[rec,rec.material] as const)),colorMaterials=new Map<THREE.Material,THREE.Material>();
 let frame=0,visible=0,selectedTriangles=0,submittedTriangles=0,frustumRejected=0,lodLevel=0,evictions=0,overBudget=false,ready=false,allocationBytes=0;
 const motion:{last?:THREE.Vector3;lastMs?:number}={};
 const detach=(rec:PageRec)=>{if(rec.attached&&rec.mesh){scene.remove(rec.mesh);rec.attached=false;}};
 const attach=(rec:PageRec)=>{if(!rec.geometry)return;
  if(!rec.mesh){const mesh=new THREE.Mesh(rec.geometry,rec.material);mesh.matrixAutoUpdate=false;mesh.frustumCulled=false;mesh.renderOrder=rec.renderOrder;rec.mesh=mesh;}
  rec.mesh.matrix.copy(rec.matrix);if(!rec.attached){scene.add(rec.mesh);rec.attached=true;}
 };
 const sync=()=>{
  const display=shown;
  const keep=new Set(display);
  for(const rec of allPages)if(rec.attached&&!keep.has(rec))detach(rec);
  submittedTriangles=0;for(const rec of display){if(!rec.array)throw new Error('AUTONOMOUS_COVERAGE_MISSING');attach(rec);submittedTriangles+=rec.triangles;}
 };
 const acceptGeometryPage=(url:string,data:DecodedGeometryPage)=>{const recs=byUrl.get(url);if(!recs)return;
  const descriptor=descriptors.get(url);if(!descriptor||data.vertexCount!==descriptor.vertexCount||data.indices.length!==descriptor.indexCount||data.flags!==descriptor.flags)throw new Error('AUTONOMOUS_PAGE_METADATA_MISMATCH');
  for(const rec of recs){detach(rec);if(rec.geometry){allocationBytes-=rec.geometry.getIndex()?.array.byteLength??0;for(const attr of Object.values(rec.geometry.attributes))allocationBytes-=attr.array.byteLength;rec.geometry.dispose();}
   const positions=data.attributes.position;for(let i=0;i<positions.length;i++){const axis=i%3;if(positions[i]<rec.min[axis]-1e-5||positions[i]>rec.max[axis]+1e-5)throw new Error('AUTONOMOUS_PAGE_BOUNDS');}
   const geometry=new THREE.BufferGeometry();geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
   for(const [name,array] of Object.entries(data.attributes))geometry.setAttribute(name,new THREE.BufferAttribute(array,name==='position'||name==='normal'?3:name==='tangent'||name==='color'?4:2));
   geometry.boundingBox=new THREE.Box3(new THREE.Vector3().fromArray(rec.min),new THREE.Vector3().fromArray(rec.max));geometry.boundingSphere=new THREE.Sphere();geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
   const original=baseMaterials.get(rec)!;
   rec.material=data.attributes.color?(Array.isArray(original)?original.map(material=>{let clone=colorMaterials.get(material);if(!clone){clone=material.clone();(clone as THREE.MeshStandardMaterial).vertexColors=true;colorMaterials.set(material,clone);}return clone;}):(()=>{let clone=colorMaterials.get(original);if(!clone){clone=original.clone();(clone as THREE.MeshStandardMaterial).vertexColors=true;colorMaterials.set(original,clone);}return clone;})()):original;
   rec.array=data.indices;rec.attributes=geometry.attributes;rec.geometry=geometry;rec.mesh=undefined;
   allocationBytes+=data.indices.byteLength;for(const array of Object.values(data.attributes))allocationBytes+=array.byteLength;
  }
 };
 return {
  id:'autonomous-pages-webgl',scene,
  capabilities:{renderer:'WebGL2 autonomous prepared pages',materials:'glTF opaque and alpha-mask materials; independent positions, normals, UVs, tangents and colors',hierarchy:true,gpuDriven:false,simplification:!!context.metadata.simplification,eviction:true,unsupported:['BLEND and transmission in autonomous mode','GPU-driven selection and indirect drawing','physical VRAM instrumentation','global illumination']},
  get overBudget(){return overBudget;},
  async prepare(){
   if(!context.readGeometryPage)throw new Error('AUTONOMOUS_PAGE_READER_MISSING');
   if(bootstrap.length>cap)throw new Error('AUTONOMOUS_ROOT_BUDGET');
   await Promise.all([...bootstrapUrls].map(async url=>{
    context.signal?.throwIfAborted();const bytes=await context.readGeometryPage!(url);context.signal?.throwIfAborted();
    acceptGeometryPage(url,await decodeGeometryPage(bytes));
   }));
   ready=true;shown.push(...bootstrap);sync();
  },
  render(camera){
   if(!ready)return;
   context.source.updateMatrixWorld(true);lighting.update();frame++;
   const selected=selectVisiblePages(roots,camera,{pixelError:resolvePixelError(context,camera,motion),viewport:context.viewport,frame,holdResident:true},shown);
   desired.length=0;desired.push(...selected.wanted);visible=selected.visible;selectedTriangles=selected.selectedTriangles;frustumRejected=selected.frustumRejected;lodLevel=selected.lodLevel;
   overBudget=shown.length>cap;if(overBudget){shown.length=0;shown.push(...bootstrap);}
   sync();
  },
  refreshSceneLighting(){lighting.refresh();},
  pendingUrls(){pending.length=0;for(const rec of desired)if(!rec.array&&!pending.includes(rec.url))pending.push(rec.url);return pending;},
  pageUrls(){retained.length=0;const unique=new Set<string>(bootstrapUrls);for(const rec of shown)unique.add(rec.url);for(const rec of desired)unique.add(rec.url);retained.push(...unique);return retained;},
  acceptGeometryPage,
  dropPage(url){if(bootstrapUrls.has(url))return;const recs=byUrl.get(url);if(!recs)return;for(const rec of recs){detach(rec);if(rec.geometry){allocationBytes-=rec.geometry.getIndex()?.array.byteLength??0;for(const attr of Object.values(rec.geometry.attributes))allocationBytes-=attr.array.byteLength;rec.geometry.dispose();}rec.geometry=undefined;rec.mesh=undefined;rec.array=undefined;evictions++;}},
  syncResident:sync,
  metrics(){return {clusters:visible,selectedTriangles,residentPages:allPages.filter(rec=>!!rec.array).length,geometryAllocationBytes:allocationBytes,pageEvictions:evictions,frustumRejected,lodLevel,submittedTriangles,drawCalls:shown.length,coverageReady:ready,coverageBudgetLimited:overBudget};},
  dispose(){ready=false;for(const rec of allPages){detach(rec);rec.geometry?.dispose();rec.geometry=undefined;rec.mesh=undefined;rec.array=undefined;}for(const material of colorMaterials.values())material.dispose();scene.clear();},
 };
};
