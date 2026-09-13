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
 const baseRoots=roots.slice(),basePages=allPages.slice();
 // The clusters nothing replaces are the coarsest complete cover; the autonomous path pins them.
 const bootstrap:PageRec[]=[];
 for(const root of roots){
  const before=bootstrap.length;
  for(const page of root.pages)if(page.parentError==null)bootstrap.push(page);
  if(bootstrap.length===before)throw new Error('INVALID_ROOT_COVERAGE');
 }
 const baseBootstrap=bootstrap.slice();
 const byUrl=indexPagesByUrl(allPages),bootstrapUrls=new Set(bootstrap.map(page=>page.url));
 const descriptors=new Map(context.metadata.primitives.flatMap(primitive=>primitive.pages).filter(page=>!!page.geometry).map(page=>[page.geometry!.url,page.geometry!] as const));
 const cap=context.maxResidentPages??Math.max(1024,bootstrapUrls.size),scene=new THREE.Scene();
 const lighting=installSceneLighting(scene,context.sceneLighting??context.source,context.clearColor??0x171d28);
 const shown:PageRec[]=[],desired:PageRec[]=[],pending:string[]=[],retained:string[]=[];
 const baseMaterials=new Map(allPages.map(rec=>[rec,rec.material] as const)),colorMaterials=new Map<THREE.Material,THREE.Material>();
 const instances=new Map<string,{roots:typeof roots;pages:PageRec[];bootstrap:PageRec[]}>();
 const modifiedPages=new Set<string>();
 let frame=0,visible=0,selectedTriangles=0,submittedTriangles=0,frustumRejected=0,lodLevel=0,cacheEvictions=0,overBudget=false,ready=false,allocationBytes=0;
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
 const geometryBytes=(geometry:THREE.BufferGeometry)=>{
  let bytes=geometry.getIndex()?.array.byteLength??0;for(const attr of Object.values(geometry.attributes))bytes+=attr.array.byteLength;return bytes;
 };
 const removeRecords=(records:PageRec[])=>{
  const removed=new Set(records);
  for(const rec of records){detach(rec);if(rec.geometry){allocationBytes-=geometryBytes(rec.geometry);rec.geometry.dispose();}rec.geometry=undefined;rec.mesh=undefined;rec.array=undefined;
   const list=byUrl.get(rec.url);if(list){const index=list.indexOf(rec);if(index>=0)list.splice(index,1);}
   baseMaterials.delete(rec);
  }
  for(const list of [allPages,bootstrap,shown,desired])for(let i=list.length-1;i>=0;i--)if(removed.has(list[i]))list.splice(i,1);
 };
 const storeGeometryPage=(url:string,data:DecodedGeometryPage)=>{const recs=byUrl.get(url);if(!recs)return;
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
 const acceptGeometryPage=(url:string,data:DecodedGeometryPage)=>{if(!modifiedPages.has(url))storeGeometryPage(url,data);};
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
  addInstance(id,transform){
   if(instances.has(id)||!id)throw new Error('AUTONOMOUS_INSTANCE_ID');
   if(bootstrap.length+baseBootstrap.length>cap)throw new Error('AUTONOMOUS_ROOT_BUDGET');
   const mapped=new Map<PageRec,PageRec>();
   for(const base of basePages){
    const geometry=base.geometry?.clone();
    const rec:PageRec={...base,clusterId:`${id}/${base.clusterId}`,matrix:transform.clone().multiply(base.matrix),geometry,attributes:geometry?.attributes??base.attributes,mesh:undefined,attached:false};
    if(geometry)allocationBytes+=geometryBytes(geometry);
    mapped.set(base,rec);allPages.push(rec);baseMaterials.set(rec,baseMaterials.get(base)!);
    let list=byUrl.get(rec.url);if(!list)byUrl.set(rec.url,list=[]);list.push(rec);
   }
   const addedRoots=baseRoots.map(root=>({...root,world:transform.clone().multiply(root.world),pages:root.pages.map(page=>mapped.get(page)!)}));
   const addedBootstrap=baseBootstrap.map(page=>mapped.get(page)!);
   roots.push(...addedRoots);bootstrap.push(...addedBootstrap);instances.set(id,{roots:addedRoots,pages:[...mapped.values()],bootstrap:addedBootstrap});
  },
  updateInstance(id,transform){
   const instance=instances.get(id);if(!instance)throw new Error('AUTONOMOUS_INSTANCE_MISSING');
   const mapped=new Map(basePages.map((base,i)=>[instance.pages[i],base] as const));
   for(let i=0;i<instance.roots.length;i++)instance.roots[i].world.copy(transform).multiply(baseRoots[i].world);
   for(const rec of instance.pages){rec.matrix.copy(transform).multiply(mapped.get(rec)!.matrix);if(rec.mesh)rec.mesh.matrix.copy(rec.matrix);}
  },
  removeInstance(id){
   const instance=instances.get(id);if(!instance)throw new Error('AUTONOMOUS_INSTANCE_MISSING');
   const removed=new Set(instance.roots);for(let i=roots.length-1;i>=0;i--)if(removed.has(roots[i]))roots.splice(i,1);
   removeRecords(instance.pages);instances.delete(id);sync();
  },
  updateMaterial(primitive,material){
   const records=allPages.filter(rec=>rec.clusterId.startsWith(`${primitive}/`)||rec.clusterId.includes(`/${primitive}/`));
   if(!records.length)throw new Error('AUTONOMOUS_PRIMITIVE_MISSING');
   for(const rec of records){baseMaterials.set(rec,material);rec.material=rec.attributes.color?(()=>{let clone=colorMaterials.get(material);if(!clone){clone=material.clone();(clone as THREE.MeshStandardMaterial).vertexColors=true;colorMaterials.set(material,clone);}return clone;})():material;if(rec.mesh)rec.mesh.material=rec.material;}
  },
  refreshSceneLighting(){lighting.refresh();},
  pendingUrls(){pending.length=0;for(const rec of desired)if(!rec.array&&!pending.includes(rec.url))pending.push(rec.url);return pending;},
  pageUrls(){retained.length=0;const unique=new Set<string>([...bootstrapUrls,...modifiedPages]);for(const rec of shown)unique.add(rec.url);for(const rec of desired)unique.add(rec.url);retained.push(...unique);return retained;},
  acceptGeometryPage,
  replaceGeometryPage(url,data){if(!byUrl.has(url))throw new Error('AUTONOMOUS_PAGE_MISSING');storeGeometryPage(url,data);modifiedPages.add(url);},
  dropPage(url){if(bootstrapUrls.has(url)||modifiedPages.has(url))return;const recs=byUrl.get(url);if(!recs)return;for(const rec of recs){detach(rec);if(rec.geometry){allocationBytes-=rec.geometry.getIndex()?.array.byteLength??0;for(const attr of Object.values(rec.geometry.attributes))allocationBytes-=attr.array.byteLength;rec.geometry.dispose();}rec.geometry=undefined;rec.mesh=undefined;rec.array=undefined;cacheEvictions++;}},
  syncResident:sync,
  metrics(){return {clusters:visible,selectedTriangles,residentPages:allPages.filter(rec=>!!rec.array).length,geometryAllocationBytes:allocationBytes,cacheEvictions,frustumRejected,lodLevel,submittedTriangles,drawCalls:shown.length,coverageReady:ready,coverageBudgetLimited:overBudget};},
  dispose(){ready=false;for(const rec of allPages){detach(rec);rec.geometry?.dispose();rec.geometry=undefined;rec.mesh=undefined;rec.array=undefined;}for(const material of colorMaterials.values())material.dispose();scene.clear();},
 };
};
