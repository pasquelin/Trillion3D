import {classifyTopology} from './topology.mjs';
import {exactClusters,greedyClusters} from './cluster.mjs';
import {simplifyToEndpoints} from './qem.mjs';
import {buildLodTree} from './lod.mjs';
import {validateAccessor} from './accessors.mjs';
export const COMPILER_VERSION='0.1.0';
export const FORMAT_VERSION=1;
export const LOD_ERROR_MODEL='qem-local-plus-child-max';
export const CLUSTER_INDEX_COUNT=768;
export const CLUSTER_TRIANGLES=256;
export class CompilerError extends Error {constructor(code,message,details={}){super(message);this.name='CompilerError';this.code=code;this.details=details;}}
const invalid=(message,details={})=>{throw new CompilerError('INVALID_GLTF',message,details);};
const encode=value=>new TextEncoder().encode(value);
const concat=arrays=>{const result=new Uint8Array(arrays.reduce((n,a)=>n+a.byteLength,0));let offset=0;for(const array of arrays){result.set(array,offset);offset+=array.byteLength;}return result;};
export function hierarchy(leaves) {
 if (!leaves.length) return null;
 const index=leaves.map((_,i)=>i);
 const build=(start,end)=>{
  const count=end-start;
  if(count<=0)return null;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let n=start;n<end;n++){
   const leaf=leaves[index[n]];
   for(let axis=0;axis<3;axis++){if(leaf.min[axis]<min[axis])min[axis]=leaf.min[axis];if(leaf.max[axis]>max[axis])max[axis]=leaf.max[axis];}
  }
  if(count===1)return {min,max,page:leaves[index[start]].id};
  let axis=0;for(let candidate=1;candidate<3;candidate++)if(max[candidate]-min[candidate]>max[axis]-min[axis])axis=candidate;
  const part=index.slice(start,end);
  part.sort((a,b)=>(leaves[a].min[axis]+leaves[a].max[axis])-(leaves[b].min[axis]+leaves[b].max[axis])||leaves[a].id-leaves[b].id);
  for(let n=0;n<part.length;n++)index[start+n]=part[n];
  const mid=start+Math.floor(count/2);
  return {min,max,children:[build(start,mid),build(mid,end)]};
 };
 return build(0,leaves.length);
}
function isSafeSourceName(name){
 return typeof name==='string'&&name.length>0&&name.length<256&&name!=='.'&&name!=='..'&&!/[\\/]/.test(name)&&!name.includes('..')&&!name.includes('\0');
}
const GLB_MAGIC=0x46546C67,GLB_JSON=0x4E4F534A,GLB_BIN=0x004E4942;
export function isGlb(bytes){
 return bytes&&bytes.byteLength>=4&&bytes[0]===0x67&&bytes[1]===0x6c&&bytes[2]===0x54&&bytes[3]===0x46;
}
export function parseGlb(bytes){
 if(!bytes||bytes.byteLength<12)invalid('GLB too short');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(view.getUint32(0,true)!==GLB_MAGIC)invalid('Not a GLB');
 if(view.getUint32(4,true)!==2)invalid('Only GLB version 2 is supported');
 if(view.getUint32(8,true)!==bytes.byteLength)invalid('GLB length mismatch');
 let offset=12,json,bin=new Uint8Array(0);
 while(offset+8<=bytes.byteLength){
  const chunkLength=view.getUint32(offset,true),chunkType=view.getUint32(offset+4,true);offset+=8;
  if(offset+chunkLength>bytes.byteLength)invalid('GLB chunk exceeds file');
  const data=bytes.subarray(offset,offset+chunkLength);offset+=chunkLength;
  if(chunkType===GLB_JSON)json=JSON.parse(new TextDecoder().decode(data));
  else if(chunkType===GLB_BIN)bin=data;
 }
 if(!json)invalid('GLB JSON chunk is required');
 return {json,bin};
}
function relativeImageUri(uri){
 return typeof uri==='string'&&uri.length>0&&!uri.startsWith('data:')&&!uri.startsWith('/')&&!/^[a-z][a-z0-9+.-]*:/i.test(uri);
}
function rewriteImages(images,resourceBaseUrl,viewMap){
 if(!Array.isArray(images))return images;
 const base=resourceBaseUrl.replace(/\/$/,'');
 return images.map(image=>{
  const copy={...image};
  if(relativeImageUri(copy.uri))copy.uri=`${base}/${copy.uri}`;
  if(Number.isInteger(copy.bufferView)){
   const mapped=viewMap.get(copy.bufferView);
   if(mapped===undefined)invalid('image.bufferView is not in the compacted buffer',{bufferView:copy.bufferView});
   copy.bufferView=mapped;
  }
  return copy;
 });
}
async function readOptional(readSource,key){
 try{return await readSource(key);}catch(error){if(error&&(error.code==='ENOENT'||error.cause?.code==='ENOENT'))return null;throw error;}
}
async function concatGltfBuffers(readSource,hash,g,embeddedBin,expected){
 if(!Array.isArray(g.buffers)||!g.buffers.length)throw new Error('glTF buffers are required');
 const chunks=[],offsets=[],lengths=[];let offset=0;
 for(const [i,buffer] of g.buffers.entries()){
  const pad=(4-offset%4)%4;if(pad){chunks.push(new Uint8Array(pad));offset+=pad;}
  offsets.push(offset);
  const uri=buffer?.uri;
  let bytes;
  if(typeof uri==='string'&&uri.length){
   if(!isSafeSourceName(uri))throw new Error('glTF buffer uri is required');
   bytes=await readSource(uri);
   if(Array.isArray(expected?.sidecars)){
    const sidecar=expected.sidecars.find(s=>s.file===uri);
    if(!sidecar||hash(bytes)!==sidecar.sha256)throw new Error('Source binary hash mismatch');
   }
  }else if(i===0&&embeddedBin){bytes=embeddedBin;}
  else throw new Error('glTF buffer uri is required');
  const declared=buffer?.byteLength;
  if(!Number.isSafeInteger(declared)||declared<0||declared>bytes.byteLength)invalid('glTF buffer byteLength exceeds source bytes',{buffer:i,declared,actual:bytes.byteLength});
  lengths.push(declared);
  chunks.push(bytes);offset+=bytes.byteLength;
 }
 return {bin:concat(chunks),offsets,lengths};
}
function unsplitMaterial(material){
 if(!material)return false;
 if((material.alphaMode??'OPAQUE')==='BLEND')return true;
 const factor=material.extensions?.KHR_materials_transmission?.transmissionFactor;
 return typeof factor==='number'&&factor>0;
}
function flattenBufferViews(g,offsets,lengths,binLength){
 if(!Array.isArray(g.bufferViews))invalid('Required glTF arrays are missing');
 g.bufferViews=g.bufferViews.map((v,id)=>{
  if(!v||typeof v!=='object')invalid('bufferView is required',{bufferView:id});
  const buffer=v.buffer===undefined?0:v.buffer;
  if(!Number.isSafeInteger(buffer))invalid('bufferView.buffer is invalid',{bufferView:id,buffer});
  if(buffer<0||buffer>=offsets.length)invalid('bufferView.buffer is out of bounds',{bufferView:id,buffer});
  const local=v.byteOffset??0,len=v.byteLength,start=offsets[buffer]+local,end=start+len;
  if(!Number.isSafeInteger(local)||!Number.isSafeInteger(len)||local<0||len<0||!Number.isSafeInteger(end)||local+len>lengths[buffer]||end>binLength)invalid('glTF buffer view exceeds declared buffer bounds',{bufferView:id,start,byteLength:len,bufferBytes:lengths[buffer]});
  return {...v,buffer:0,byteOffset:start};
 });
 g.buffers=[{byteLength:binLength}];
}
async function loadGltfDocument(readSource,hash,fileName,expected){
 if(!isSafeSourceName(fileName))throw new Error('manifest.runtime.file is required');
 const bytes=await readSource(fileName);
 if(expected?.sha256&&hash(bytes)!==expected.sha256)throw new Error('Source glTF hash mismatch');
 const parsed=isGlb(bytes)?parseGlb(bytes):{json:JSON.parse(new TextDecoder().decode(bytes)),bin:null};
 const g=parsed.json;
 const {bin,offsets,lengths}=await concatGltfBuffers(readSource,hash,g,parsed.bin,expected);
 flattenBufferViews(g,offsets,lengths,bin.byteLength);
 return {g,jsonBytes:bytes,bin,sourceSha256:hash(bytes),sourceBinarySha256:hash(bin)};
}
/** Compiler ports operate on relative logical keys, with no filesystem or browser dependencies. */
export async function compileAsset({source:sourceStore,cache,hash,compilerHash,resourceBaseUrl,scope='slice',budget=150000,strategy='exact-source-order',simplification='none',runtimeFile,signal,onProgress=()=>{}}) {
 const check=()=>signal?.throwIfAborted();check();
 if(typeof compilerHash!=='string'||!/^[a-f0-9]{64}$/.test(compilerHash))throw new Error('compilerHash SHA-256 is required for cache identity');
 if(!resourceBaseUrl||typeof resourceBaseUrl!=='string')throw new Error('resourceBaseUrl is required');
 const readFile=async key=>{check();return sourceStore.read(key);};
 const atomic=async(key,bytes)=>{check();await cache.writeAtomic(key,typeof bytes==='string'?new TextEncoder().encode(bytes):bytes);};
 const join=(...parts)=>parts.join('/');
 const readSource=readFile;

 if(!Number.isSafeInteger(budget)||budget<1)throw new Error('Invalid triangle budget');
 if(!['slice','full'].includes(scope))throw new Error('scope must be slice or full');
 if(!['exact-source-order','greedy-adjacency'].includes(strategy))throw new Error('Unsupported cluster strategy');
 if(!['none','qem-endpoints'].includes(simplification))throw new Error('Unsupported simplification');
 const manifestBytes=await readOptional(readSource,'manifest.json');
 let loaded,manifest;
 if(manifestBytes){
  manifest=JSON.parse(new TextDecoder().decode(manifestBytes));
  if(manifest.status!=='ready')throw new Error('Source runtime not ready');
  loaded=await loadGltfDocument(readSource,hash,manifest.runtime?.file,{sha256:manifest.runtime?.sha256,sidecars:manifest.runtime?.sidecars});
 }else{
  if(!isSafeSourceName(runtimeFile))throw new Error('manifest.json is required unless runtimeFile is a .gltf or .glb');
  loaded=await loadGltfDocument(readSource,hash,runtimeFile);
  manifest={status:'ready',runtime:{file:runtimeFile,sha256:loaded.sourceSha256,sidecars:[],trianglesAcrossNodes:null,meshNodes:null}};
 }
 const {g,jsonBytes,bin}=loaded;
 const key=hash(concat([manifestBytes??encode(''),jsonBytes,encode(hash(bin)),encode(compilerHash),encode(`${scope}:${budget}:${resourceBaseUrl}:${strategy}:${simplification}:${LOD_ERROR_MODEL}`)]));
 const directory=join('reference',scope,key);
 const emit=(phase,completed,total)=>(check(),onProgress({phase,completed,total,scope,key}));
 const chosen=new Set();let triangles=0,sourceTriangles=0,meshNodes=0;
 if(!Array.isArray(g.nodes)||!Array.isArray(g.meshes)||!Array.isArray(g.accessors)||!Array.isArray(g.bufferViews))invalid('Required glTF arrays are missing');
 const accessorAt=(id,label)=>{if(!Number.isSafeInteger(id)||id<0||id>=g.accessors.length)invalid(`${label} accessor is required`,{id});return g.accessors[id];};
 const primitiveTriangles=(p,mesh,primitive)=>{
  if(p.attributes?.POSITION===undefined)invalid('Primitive POSITION accessor is required',{mesh,primitive});
  if(p.indices===undefined){
   const accessor=accessorAt(p.attributes.POSITION,'POSITION');
   if(!Number.isSafeInteger(accessor.count)||accessor.count<3||accessor.count%3!==0)invalid('Unindexed POSITION count must be a positive multiple of three',{mesh,primitive,count:accessor.count});
   return accessor.count/3;
  }
  const accessor=accessorAt(p.indices,'indices');
  if(!Number.isSafeInteger(accessor.count)||accessor.count<3||accessor.count%3!==0)invalid('Index count must be a positive multiple of three',{mesh,primitive,count:accessor.count});
  return accessor.count/3;
 };
 const nodeTriangles=(i,n)=>{
  const primitives=g.meshes[n.mesh]?.primitives;if(!Array.isArray(primitives))invalid('Mesh primitives are required',{node:i,mesh:n.mesh});
  return primitives.reduce((s,p,primitive)=>s+primitiveTriangles(p,n.mesh,primitive),0);
 };
 const overflowing=[];
 for(const [i,n] of g.nodes.entries())if(n.mesh!==undefined){
  const count=nodeTriangles(i,n);meshNodes++;sourceTriangles+=count;
  if(scope==='full'||triangles+count<=budget){chosen.add(i);triangles+=count;}
  else overflowing.push({i,count});
 }
 if(!chosen.size){
  overflowing.sort((a,b)=>a.count-b.count||a.i-b.i);
  if(!overflowing.length)throw new Error('No complete mesh instance fits the slice budget');
  chosen.add(overflowing[0].i);triangles=overflowing[0].count;
 }
 const meshIds=[...new Set([...chosen].map(i=>g.nodes[i].mesh))],meshMap=new Map(meshIds.map((id,i)=>[id,i]));
 const skinAccessors=(Array.isArray(g.skins)?g.skins:[]).flatMap(skin=>skin.inverseBindMatrices===undefined?[]:[(accessorAt(skin.inverseBindMatrices,'skin.inverseBindMatrices'),skin.inverseBindMatrices)]);
 const animAccessors=(Array.isArray(g.animations)?g.animations:[]).flatMap(anim=>Array.isArray(anim.samplers)?anim.samplers.flatMap(s=>[s.input,s.output].filter(id=>id!==undefined).map(id=>(accessorAt(id,'animation sampler'),id))):[]);
 const accessorIds=[...new Set([
  ...meshIds.flatMap(id=>g.meshes[id].primitives.flatMap((p,primitive)=>{
   if(p.attributes?.POSITION===undefined)invalid('Primitive POSITION accessor is required',{mesh:id,primitive});
   const ids=[...Object.values(p.attributes)];
   if(p.indices!==undefined)ids.unshift(p.indices);
   if(Array.isArray(p.targets))ids.push(...p.targets.flatMap(t=>Object.values(t)));
   return ids;
  })),
  ...skinAccessors,
  ...animAccessors
 ])];
 for(const id of accessorIds)validateAccessor(g,bin,id);
 const accessMap=new Map(accessorIds.map((id,i)=>[id,i]));
 const accessorViews=accessorIds.flatMap(id=>{
  const a=g.accessors[id];const res=[];
  if(Number.isInteger(a.bufferView))res.push(a.bufferView);
  if(a.sparse){
   if(Number.isInteger(a.sparse.indices?.bufferView))res.push(a.sparse.indices.bufferView);
   if(Number.isInteger(a.sparse.values?.bufferView))res.push(a.sparse.values.bufferView);
  }
  return res;
 });
 const imageViews=(Array.isArray(g.images)?g.images:[]).flatMap((image,id)=>{if(image?.bufferView===undefined)return [];if(!Number.isSafeInteger(image.bufferView)||image.bufferView<0||!g.bufferViews[image.bufferView])invalid('image.bufferView is invalid',{image:id});return [image.bufferView];});
 const viewIds=[...new Set([...accessorViews,...imageViews])],viewMap=new Map(viewIds.map((id,i)=>[id,i]));
 let offset=0;const chunks=[],views=[];
 for(const id of viewIds){const v=g.bufferViews[id];if(!v||v.buffer!==0)throw new Error('Multiple buffers unsupported');const start=v.byteOffset??0,end=start+v.byteLength;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(v.byteLength)||start<0||v.byteLength<0||end>bin.byteLength)invalid('glTF buffer view exceeds binary bounds',{bufferView:id,start,byteLength:v.byteLength,binaryBytes:bin.byteLength});const pad=(4-offset%4)%4;chunks.push(new Uint8Array(pad));offset+=pad;chunks.push(bin.subarray(start,end));views.push({...v,byteOffset:offset});offset+=v.byteLength;}
 const source={...g,buffers:[{uri:'source.bin',byteLength:offset}],bufferViews:views,
  accessors:accessorIds.map(id=>{
   const a={...g.accessors[id]};
   if(a.bufferView!==undefined)a.bufferView=viewMap.get(a.bufferView);
   if(a.sparse){
    a.sparse={...a.sparse,indices:{...a.sparse.indices,bufferView:viewMap.get(a.sparse.indices.bufferView)},values:{...a.sparse.values,bufferView:viewMap.get(a.sparse.values.bufferView)}};
   }
   return a;
  }),
  meshes:meshIds.map(id=>({...g.meshes[id],primitives:g.meshes[id].primitives.map(p=>({...p,indices:p.indices===undefined?undefined:accessMap.get(p.indices),attributes:Object.fromEntries(Object.entries(p.attributes).map(([k,v])=>[k,accessMap.get(v)])),targets:Array.isArray(p.targets)?p.targets.map(t=>Object.fromEntries(Object.entries(t).map(([k,v])=>[k,accessMap.get(v)]))):undefined}))})),
  skins:Array.isArray(g.skins)?g.skins.map(skin=>({...skin,inverseBindMatrices:skin.inverseBindMatrices!==undefined?accessMap.get(skin.inverseBindMatrices):undefined})):undefined,
  animations:Array.isArray(g.animations)?g.animations.map(anim=>({...anim,samplers:Array.isArray(anim.samplers)?anim.samplers.map(s=>({...s,input:s.input!==undefined?accessMap.get(s.input):undefined,output:s.output!==undefined?accessMap.get(s.output):undefined})):anim.samplers})):undefined,
  nodes:g.nodes.map((n,i)=>{const copy={...n};if(copy.mesh!==undefined){if(chosen.has(i))copy.mesh=meshMap.get(copy.mesh);else delete copy.mesh;}return copy;}),
  images:rewriteImages(g.images,resourceBaseUrl,viewMap)};
 const view=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 const read=(id)=>{const a=accessorAt(id,'primitive');if(a.normalized)throw new Error('Normalized accessor unsupported');const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4},bytes={5121:1,5123:2,5125:4,5126:4};
  const w=widths[a.type],b=bytes[a.componentType];if(!w||!b)throw new Error('Accessor unsupported');
  const count=a.count*w;let values;
  if(a.bufferView===undefined){
   values=a.componentType===5126?new Float32Array(count):b===1?new Uint8Array(count):b===2?new Uint16Array(count):new Uint32Array(count);
  }else{
   const v=g.bufferViews[a.bufferView];if(!v)invalid('Accessor bufferView is required',{accessor:id});
   const base=(v.byteOffset??0)+(a.byteOffset??0),stride=v.byteStride??w*b;
   if(stride===w*b&&(bin.byteOffset+base)%b===0&&bin.byteOffset+base+count*b<=bin.buffer.byteLength){
    const offset=bin.byteOffset+base;
    if(a.componentType===5126)values=new Float32Array(bin.buffer,offset,count).slice();
    else if(b===1)values=new Uint8Array(bin.buffer,offset,count).slice();
    else if(b===2)values=new Uint16Array(bin.buffer,offset,count).slice();
    else values=new Uint32Array(bin.buffer,offset,count).slice();
   }else{
    values=a.componentType===5126?new Float32Array(count):b===1?new Uint8Array(count):b===2?new Uint16Array(count):new Uint32Array(count);
    for(let i=0;i<a.count;i++)for(let j=0;j<w;j++){const o=base+i*stride+j*b;values[i*w+j]=a.componentType===5126?view.getFloat32(o,true):b===1?bin[o]:b===2?view.getUint16(o,true):view.getUint32(o,true);}
   }
  }
  if(a.sparse){
   const sc=a.sparse.count;const indView=g.bufferViews[a.sparse.indices.bufferView];const valView=g.bufferViews[a.sparse.values.bufferView];
   const indComp=a.sparse.indices.componentType;const indBase=(indView.byteOffset??0)+(a.sparse.indices.byteOffset??0);const valBase=(valView.byteOffset??0)+(a.sparse.values.byteOffset??0);
   for(let k=0;k<sc;k++){
    const io=indBase+k*(indComp===5121?1:indComp===5123?2:4);
    const idx=indComp===5121?bin[io]:indComp===5123?view.getUint16(io,true):view.getUint32(io,true);
    for(let c=0;c<w;c++){
     const vo=valBase+(k*w+c)*b;
     const val=a.componentType===5126?view.getFloat32(vo,true):b===1?bin[vo]:b===2?view.getUint16(vo,true):view.getUint32(vo,true);
     values[idx*w+c]=val;
    }
   }
  }
  return values;
 };
 const skinnedMeshes=new Set(g.nodes.filter(n=>n.mesh!==undefined&&n.skin!==undefined).map(n=>n.mesh));
 const primitives=[];let completed=0,total=meshIds.reduce((s,id)=>s+g.meshes[id].primitives.length,0),bytesWritten=0,reusedPages=0;
 for(const [mesh,id] of meshIds.entries())for(const [primitive,p] of g.meshes[id].primitives.entries()){
  check();if((p.mode??4)!==4)throw new Error('Only static triangles supported');
  const positionAccessor=accessorAt(p.attributes.POSITION,'POSITION');
  if(positionAccessor.type!=='VEC3'||positionAccessor.componentType!==5126)invalid('POSITION must be float VEC3',{mesh,primitive});
  if(p.indices!==undefined){const indexAccessor=accessorAt(p.indices,'indices');if(indexAccessor.type!=='SCALAR'||![5121,5123,5125].includes(indexAccessor.componentType))invalid('indices component must be unsigned SCALAR',{mesh,primitive});}
  const positions=read(p.attributes.POSITION),indices=p.indices===undefined?Uint32Array.from({length:positions.length/3},(_,i)=>i):read(p.indices);
  if(positions.some(value=>!Number.isFinite(value)))invalid('POSITION contains nonfinite values',{mesh,primitive});
  const isSkinnedOrMorph=Boolean(p.targets||skinnedMeshes.has(id)||p.attributes?.JOINTS_0!==undefined||p.attributes?.WEIGHTS_0!==undefined);
  const blend=unsplitMaterial(g.materials?.[p.material])||isSkinnedOrMorph;
  const topology=classifyTopology(indices,positions.length/3);
  const clusters=strategy==='greedy-adjacency'?greedyClusters(indices,topology.neighbors):exactClusters(indices.length);
  const pages=[];
  const writePage=async(indexList,role,start)=>{
   const values=new Uint32Array(indexList.length),data=new Uint8Array(values.buffer),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
   for(let i=0;i<indexList.length;i++){const index=indexList[i];if(!Number.isSafeInteger(index)||index<0||index*3+2>=positions.length)invalid('Invalid index',{mesh,primitive,index});values[i]=index;for(let a=0;a<3;a++){const v=positions[index*3+a];if(!Number.isFinite(v))invalid('Invalid position',{mesh,primitive,index});if(v<min[a])min[a]=v;if(v>max[a])max[a]=v;}}
   const name=`pages/${mesh}-${primitive}-${pages.length}.bin`,sha256=hash(data);let exists=false;try{exists=hash(await cache.read(join(directory,name)))===sha256;}catch{}
   if(!exists){await atomic(join(directory,name),data);bytesWritten+=data.length;}else reusedPages++;
   const id=pages.length;
   pages.push({id,url:name,sha256,bytes:data.length,count:values.length,start,min,max,role});
   return id;
  };
  const clusterPageIds=[];
  if(!blend)for(const cluster of clusters){const indexList=[];for(let t=0;t<cluster.length;t++)for(let k=0;k<3;k++)indexList.push(indices[cluster[t]*3+k]);clusterPageIds.push(await writePage(indexList,'exact',cluster[0]*3));}
  const materializeLod=async node=>{
   if(node.type==='leaf')return {min:node.min,max:node.max,page:clusterPageIds[node.clusterIndex]};
   const children=[];
   for(const child of node.children)children.push(await materializeLod(child));
   const list=node.reduced?(node.coarseIndices??node.mesh??[]):[];
   if(!list.length)return {min:node.min,max:node.max,children};
   const coarsePages=[];
   for(let start=0;start<list.length;start+=CLUSTER_INDEX_COUNT)coarsePages.push(await writePage(list.slice(start,start+CLUSTER_INDEX_COUNT),'coarse',start));
   return {min:node.min,max:node.max,errorObject:node.errorObject,coarsePages,children};
  };
  let tree=null;
  if(!blend&&simplification==='qem-endpoints'&&clusters.length>=2){
   const lod=buildLodTree(positions,indices,clusters,topology.neighbors);
   tree=lod?await materializeLod(lod):hierarchy(pages.filter(page=>page.role!=='coarse'));
  }else{
   tree=hierarchy(pages.filter(page=>page.role!=='coarse'));
   if(!blend&&simplification==='qem-endpoints'&&indices.length>=6){
    const simplified=simplifyToEndpoints(positions,indices,{targetTriangles:Math.max(1,Math.floor(indices.length/12))});
    if(simplified.triangles*3<indices.length){
     const coarseIds=[];
     for(let start=0;start<simplified.indices.length;start+=CLUSTER_INDEX_COUNT)coarseIds.push(await writePage(simplified.indices.slice(start,start+CLUSTER_INDEX_COUNT),'coarse',start));
     if(tree){tree.errorObject=simplified.errorObject;tree.coarsePages=coarseIds;}
    }
   }
  }
  primitives.push({mesh,primitive,material:p.material,triangles:indices.length/3,pass:blend?'shared-blend':'exact-clusters',pages,hierarchy:tree,topology:{triangles:topology.triangles,edges:topology.edges,vertices:topology.vertices,manifold:topology.manifold}});emit('clusterize',++completed,total);
 }
 await atomic(join(directory,'source.bin'),concat(chunks));await atomic(join(directory,'source.gltf'),JSON.stringify(source));
 const result={schema:FORMAT_VERSION,formatVersion:FORMAT_VERSION,compilerVersion:COMPILER_VERSION,compilerHash,errorModel:LOD_ERROR_MODEL,status:'ready',key,scope,clusterStrategy:strategy,sourceSha256:loaded.sourceSha256,sourceBinarySha256:loaded.sourceBinarySha256,sourceTriangles,selectedTriangles:triangles,selectedNodes:[...chosen],totalNodes:meshNodes,clusterTriangles:CLUSTER_TRIANGLES,simplification:simplification!=='none',gpuDriven:false,materials:'glTF preserved; BLEND and transmission remain unsplit',primitives,bytesWritten,reusedPages};
 await atomic(join(directory,'clusters.json'),JSON.stringify(result));await atomic(join('reference',scope,'manifest.json'),JSON.stringify({status:'ready',formatVersion:FORMAT_VERSION,compiler:'reference-js',key,scope,url:`${key}/clusters.json`}));emit('complete',total,total);return result;
}
