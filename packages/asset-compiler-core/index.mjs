import {classifyTopology} from './topology.mjs';
import {exactClusters,greedyClusters} from './cluster.mjs';
import {simplifyToEndpoints} from './qem.mjs';
import {buildLodTree} from './lod.mjs';
export const COMPILER_VERSION='0.1.0';
export const FORMAT_VERSION=1;
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
/** Compiler ports operate on relative logical keys, with no filesystem or browser dependencies. */
export async function compileAsset({source:sourceStore,cache,hash,compilerHash,resourceBaseUrl,scope='slice',budget=150000,strategy='exact-source-order',simplification='none',signal,onProgress=()=>{}}) {
 const check=()=>signal?.throwIfAborted();check();
 if(!resourceBaseUrl||typeof resourceBaseUrl!=='string')throw new Error('resourceBaseUrl is required');
 const readFile=async key=>{check();return sourceStore.read(key);};
 const atomic=async(key,bytes)=>{check();await cache.writeAtomic(key,typeof bytes==='string'?new TextEncoder().encode(bytes):bytes);};
 const join=(...parts)=>parts.join('/');
 const readSource=readFile;

 if(!Number.isSafeInteger(budget)||budget<1)throw new Error('Invalid triangle budget');
 if(!['slice','full'].includes(scope))throw new Error('scope must be slice or full');
 if(!['exact-source-order','greedy-adjacency'].includes(strategy))throw new Error('Unsupported cluster strategy');
 if(!['none','qem-endpoints'].includes(simplification))throw new Error('Unsupported simplification');
 const manifestBytes=await readSource('manifest.json'),manifest=JSON.parse(new TextDecoder().decode(manifestBytes));
 if(manifest.status!=='ready')throw new Error('Source runtime not ready');
 const gltfFile=manifest.runtime?.file;
 if(!isSafeSourceName(gltfFile))throw new Error('manifest.runtime.file is required');
 const jsonBytes=await readSource(gltfFile),g=JSON.parse(new TextDecoder().decode(jsonBytes));
 if(hash(jsonBytes)!==manifest.runtime.sha256)throw new Error('Source glTF hash mismatch');
 if(!Array.isArray(g.buffers)||g.buffers.length!==1)throw new Error('Multiple buffers unsupported');
 const binName=g.buffers[0]?.uri;
 if(!isSafeSourceName(binName))throw new Error('glTF buffer uri is required');
 const sidecar=(manifest.runtime.sidecars??[]).find(s=>s.file===binName);
 const bin=await readSource(binName);
 if(!sidecar||hash(bin)!==sidecar.sha256)throw new Error('Source binary hash mismatch');
 const key=hash(concat([manifestBytes,jsonBytes,encode(hash(bin)),encode(compilerHash??COMPILER_VERSION),encode(`${scope}:${budget}:${resourceBaseUrl}:${strategy}:${simplification}`)]));
 const directory=join('reference',scope,key);
 const emit=(phase,completed,total)=>(check(),onProgress({phase,completed,total,scope,key}));
 const chosen=new Set();let triangles=0;
 if(!Array.isArray(g.nodes)||!Array.isArray(g.meshes)||!Array.isArray(g.accessors)||!Array.isArray(g.bufferViews))invalid('Required glTF arrays are missing');
 const accessorAt=(id,label)=>{if(!Number.isSafeInteger(id)||id<0||id>=g.accessors.length)invalid(`${label} accessor is required`,{id});return g.accessors[id];};
 for(const [i,n] of g.nodes.entries())if(n.mesh!==undefined){
  if(n.skin!==undefined)throw new Error('Skinned geometry unsupported');
  const primitives=g.meshes[n.mesh]?.primitives;if(!Array.isArray(primitives))invalid('Mesh primitives are required',{node:i,mesh:n.mesh});
  const count=primitives.reduce((s,p,primitive)=>{if(p.indices===undefined)invalid('Primitive indices accessor is required',{mesh:n.mesh,primitive});if(p.attributes?.POSITION===undefined)invalid('Primitive POSITION accessor is required',{mesh:n.mesh,primitive});const accessor=accessorAt(p.indices,'indices');if(!Number.isSafeInteger(accessor.count)||accessor.count<3||accessor.count%3!==0)invalid('Index count must be a positive multiple of three',{mesh:n.mesh,primitive,count:accessor.count});return s+accessor.count/3;},0);
  if(scope==='full'||triangles+count<=budget){chosen.add(i);triangles+=count;}
 }
 if(!chosen.size)throw new Error('No complete mesh instance fits the slice budget');
 const meshIds=[...new Set([...chosen].map(i=>g.nodes[i].mesh))],meshMap=new Map(meshIds.map((id,i)=>[id,i]));
 const accessorIds=[...new Set(meshIds.flatMap(id=>g.meshes[id].primitives.flatMap((p,primitive)=>{if(p.indices===undefined)invalid('Primitive indices accessor is required',{mesh:id,primitive});if(p.attributes?.POSITION===undefined)invalid('Primitive POSITION accessor is required',{mesh:id,primitive});return [p.indices,...Object.values(p.attributes)];})))];
 const accessMap=new Map(accessorIds.map((id,i)=>[id,i]));
 const viewIds=[...new Set(accessorIds.map(id=>g.accessors[id].bufferView))],viewMap=new Map(viewIds.map((id,i)=>[id,i]));
 let offset=0;const chunks=[],views=[];
 for(const id of viewIds){const v=g.bufferViews[id];if(!v||v.buffer!==0)throw new Error('Multiple buffers unsupported');const start=v.byteOffset??0,end=start+v.byteLength;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(v.byteLength)||start<0||v.byteLength<0||end>bin.byteLength)invalid('glTF buffer view exceeds binary bounds',{bufferView:id,start,byteLength:v.byteLength,binaryBytes:bin.byteLength});const pad=(4-offset%4)%4;chunks.push(new Uint8Array(pad));offset+=pad;chunks.push(bin.subarray(start,end));views.push({...v,byteOffset:offset});offset+=v.byteLength;}
 const source={...g,buffers:[{uri:'source.bin',byteLength:offset}],bufferViews:views,accessors:accessorIds.map(id=>({...g.accessors[id],bufferView:viewMap.get(g.accessors[id].bufferView)})),
  meshes:meshIds.map(id=>({...g.meshes[id],primitives:g.meshes[id].primitives.map(p=>({...p,indices:accessMap.get(p.indices),attributes:Object.fromEntries(Object.entries(p.attributes).map(([k,v])=>[k,accessMap.get(v)]))}))})),
  nodes:g.nodes.map((n,i)=>{const copy={...n};if(copy.mesh!==undefined){if(chosen.has(i))copy.mesh=meshMap.get(copy.mesh);else delete copy.mesh;}return copy;}),
  images:g.images.map(image=>({...image,uri:resourceBaseUrl.replace(/\/$/,'')+'/'+image.uri}))};
 const view=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 const read=(id)=>{const a=accessorAt(id,'primitive'),v=g.bufferViews[a.bufferView];if(!v)invalid('Accessor bufferView is required',{accessor:id});if(a.sparse||a.normalized)throw new Error('Sparse/normalized accessor unsupported');const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4},bytes={5121:1,5123:2,5125:4,5126:4};
  const w=widths[a.type],b=bytes[a.componentType];if(!w||!b)throw new Error('Accessor unsupported');
  const count=a.count*w,base=(v.byteOffset??0)+(a.byteOffset??0),stride=v.byteStride??w*b;
  if(stride===w*b&&(bin.byteOffset+base)%b===0&&bin.byteOffset+base+count*b<=bin.buffer.byteLength){
   const offset=bin.byteOffset+base;
   if(a.componentType===5126)return new Float32Array(bin.buffer,offset,count).slice();
   if(b===1)return new Uint8Array(bin.buffer,offset,count).slice();
   if(b===2)return new Uint16Array(bin.buffer,offset,count).slice();
   return new Uint32Array(bin.buffer,offset,count).slice();
  }
  const values=a.componentType===5126?new Float32Array(count):b===1?new Uint8Array(count):b===2?new Uint16Array(count):new Uint32Array(count);
  for(let i=0;i<a.count;i++)for(let j=0;j<w;j++){const o=base+i*stride+j*b;values[i*w+j]=a.componentType===5126?view.getFloat32(o,true):b===1?bin[o]:b===2?view.getUint16(o,true):view.getUint32(o,true);}return values;};
 const primitives=[];let completed=0,total=meshIds.reduce((s,id)=>s+g.meshes[id].primitives.length,0),bytesWritten=0,reusedPages=0;
 for(const [mesh,id] of meshIds.entries())for(const [primitive,p] of g.meshes[id].primitives.entries()){
  check();if((p.mode??4)!==4||p.targets)throw new Error('Only static triangles supported');
  const indices=read(p.indices),positions=read(p.attributes.POSITION),blend=(g.materials[p.material]?.alphaMode??'OPAQUE')==='BLEND';
  const topology=classifyTopology(indices,positions.length/3);
  const clusters=strategy==='greedy-adjacency'?greedyClusters(indices,topology.neighbors):exactClusters(indices.length);
  const pages=[];
  const writePage=async(indexList,role,start)=>{
   const values=new Uint32Array(indexList.length),data=new Uint8Array(values.buffer),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
   for(let i=0;i<indexList.length;i++){const index=indexList[i];if(index*3+2>=positions.length)throw new Error('Invalid index');values[i]=index;for(let a=0;a<3;a++){const v=positions[index*3+a];if(!Number.isFinite(v))throw new Error('Invalid position');if(v<min[a])min[a]=v;if(v>max[a])max[a]=v;}}
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
 const result={schema:FORMAT_VERSION,formatVersion:FORMAT_VERSION,compilerVersion:COMPILER_VERSION,compilerHash,status:'ready',key,scope,clusterStrategy:strategy,sourceSha256:manifest.runtime.sha256,sourceBinarySha256:sidecar.sha256,sourceTriangles:manifest.runtime.trianglesAcrossNodes,selectedTriangles:triangles,selectedNodes:[...chosen],totalNodes:manifest.runtime.meshNodes,clusterTriangles:CLUSTER_TRIANGLES,simplification:simplification!=='none',gpuDriven:false,materials:'glTF preserved; BLEND remains unsplit in both variants',primitives,bytesWritten,reusedPages};
 await atomic(join(directory,'clusters.json'),JSON.stringify(result));await atomic(join('reference',scope,'manifest.json'),JSON.stringify({status:'ready',formatVersion:FORMAT_VERSION,compiler:'reference-js',key,scope,url:`${key}/clusters.json`}));emit('complete',total,total);return result;
}
