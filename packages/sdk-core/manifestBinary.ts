import {EngineError,type ClusterGroup,type ClusterManifest,type ClusterStructure,type CullingHierarchy,type GeometryPageDescriptor,type Page,type Primitive,type StreamBundle,type StreamCatalogue} from './contracts.ts';

/**
 * Binary sidecar for a cluster manifest.
 *
 * A cluster cache describes tens of thousands of clusters with a dozen numbers each. Written as
 * JSON that is tens of megabytes the browser has to tokenize before the first frame; written as
 * typed-array columns it is a single `fetch` and a handful of views. The small JSON that stays
 * beside it keeps everything a human or a tool reads — primitives, materials, the group structure
 * counts, the bundle catalogue — plus the pointer to the columns.
 *
 * Layout, little-endian:
 *
 *   u32 magic 'WGMB' · u32 version · u32 columnCount · u32 reserved
 *   columnCount × (u32 byteOffset, u32 byteLength)
 *   column payloads, each starting on an 8-byte boundary
 *
 * Columns are fixed by version: their order, element type and stride are the format. Reading one
 * is `new Float64Array(buffer, offset, length/8)`, so decoding costs no parse at all.
 */
export const MANIFEST_BINARY_VERSION=1;
/** 'W','G','M','B' read as a little-endian u32. */
export const MANIFEST_BINARY_MAGIC=0x424d4757;
export const MANIFEST_BINARY_HEADER_WORDS=4;

const COLUMN_NAMES=[
 'pageBounds','pageSphere','pageParentSphere','pageError','pageInt','pageU32','pageSha',
 'geometrySha','geometryU32','cullingNodes','groupLevel','groupError','groupSphere',
 'groupChildCount','groupChild','groupOutputCount','groupOutput','structureRoot',
 'bundleU32','bundleSha',
] as const;
type ColumnName=typeof COLUMN_NAMES[number];
type ColumnKind='f64'|'i32'|'u32'|'u8';
const COLUMN_KIND:Record<ColumnName,ColumnKind>={
 pageBounds:'f64',pageSphere:'f64',pageParentSphere:'f64',pageError:'f64',pageInt:'i32',pageU32:'u32',pageSha:'u8',
 geometrySha:'u8',geometryU32:'u32',cullingNodes:'f64',groupLevel:'i32',groupError:'f64',groupSphere:'f64',
 groupChildCount:'i32',groupChild:'i32',groupOutputCount:'i32',groupOutput:'i32',structureRoot:'i32',
 bundleU32:'u32',bundleSha:'u8',
};
/** Numbers per element. A sha is 64 ASCII hexadecimal characters: one `TextDecoder` for the whole
 *  column, then one `substring` per entry, is far cheaper than re-encoding 32 raw bytes each time. */
const COLUMN_STRIDE:Record<ColumnName,number>={
 pageBounds:6,pageSphere:4,pageParentSphere:4,pageError:2,pageInt:8,pageU32:2,pageSha:64,
 geometrySha:64,geometryU32:5,cullingNodes:15,groupLevel:1,groupError:1,groupSphere:4,
 groupChildCount:1,groupChild:1,groupOutputCount:1,groupOutput:1,structureRoot:1,
 bundleU32:2,bundleSha:64,
};
const BYTES_PER_ELEMENT:Record<ColumnKind,number>={f64:8,i32:4,u32:4,u8:1};

/** `pageInt` slots. -1 is «absent or null»; the flag word says which. */
const INT_ID=0,INT_LEVEL=1,INT_GROUP=2,INT_SOURCE=3,INT_STREAM=4,INT_STREAM_OFFSET=5,INT_COUNT=6,INT_START=7;
/** `pageU32` slots. */
const U32_BYTES=0,U32_FLAGS=1;
const FLAG_ROLE=1,FLAG_COARSE=2,FLAG_GEOMETRY=4,FLAG_CLUSTER_ERROR=8,FLAG_PARENT_ERROR=16,
 FLAG_PARENT_ERROR_FINITE=32,FLAG_PARENT_SPHERE=64,FLAG_PARENT_SPHERE_SET=128,FLAG_GROUP=256,FLAG_SOURCE=512;

/** Where the binary sits and how a cluster, a packed page and a bundle name their object. */
export interface ManifestBinaryDescriptor {
 version:number;url:string;sha256:string;bytes:number;
 /** `{sha}` is replaced by the 64 hexadecimal characters of the object digest. */
 pageUrl:string;geometryUrl:string;bundleUrl:string;
}
interface SlimCulling {stride:number;count:number}
interface SlimStructure {version:number;groups:number;roots:number}
interface SlimStreams {version:number;pinned:number;bundleBytes:number;pages:number}
/** Counts and constants a primitive needs to find its own slice of every column. */
export interface SlimPrimitiveBinary {pages:number;culling?:SlimCulling|null;structure?:SlimStructure|null;streams?:SlimStreams|null}
export type SlimPrimitive=Omit<Primitive,'pages'|'culling'|'structure'|'streams'>&{binary:SlimPrimitiveBinary};
export type SlimClusterManifest=Omit<ClusterManifest,'primitives'>&{binary:ManifestBinaryDescriptor;primitives:SlimPrimitive[]};

export function isBinaryManifest(value:{binary?:unknown}):boolean{
 const binary=value.binary;
 return !!binary&&typeof binary==='object'&&!Array.isArray(binary)&&typeof (binary as {url?:unknown}).url==='string';
}
/** Rejects a sidecar this build cannot read, before any byte is fetched. */
export function assertManifestBinary(binary:unknown):asserts binary is ManifestBinaryDescriptor{
 if(!binary||typeof binary!=='object'||Array.isArray(binary))throw new EngineError('UNSUPPORTED_FORMAT','Manifest binary descriptor is not an object',{});
 const descriptor=binary as Partial<ManifestBinaryDescriptor>;
 if(descriptor.version!==MANIFEST_BINARY_VERSION)throw new EngineError('UNSUPPORTED_FORMAT',`Expected manifest binary version ${MANIFEST_BINARY_VERSION}, received ${String(descriptor.version)}`,{version:descriptor.version??null,expected:MANIFEST_BINARY_VERSION});
 for(const key of ['url','sha256','pageUrl','geometryUrl','bundleUrl'] as const)if(typeof descriptor[key]!=='string'||!descriptor[key])throw new EngineError('UNSUPPORTED_FORMAT',`Manifest binary descriptor misses ${key}`,{key});
 if(!Number.isSafeInteger(descriptor.bytes)||descriptor.bytes!<0)throw new EngineError('UNSUPPORTED_FORMAT','Manifest binary descriptor has no byte length',{bytes:descriptor.bytes??null});
 for(const key of ['pageUrl','geometryUrl','bundleUrl'] as const)if(!descriptor[key]!.includes('{sha}'))throw new EngineError('UNSUPPORTED_FORMAT',`Manifest binary template ${key} has no {sha} placeholder`,{key,template:descriptor[key]});
}

function hexDigits(sha:string){
 if(sha.length!==64||!/^[0-9a-f]{64}$/.test(sha))throw new EngineError('INVALID_CACHE','A cache object digest is not 64 lowercase hexadecimal characters',{sha256:sha});
 return sha;
}
const align8=(value:number)=>(value+7)&~7;

interface Counts {pages:number;cullingNodes:number;groups:number;children:number;outputs:number;roots:number;bundles:number}
function countManifest(manifest:ClusterManifest):Counts{
 const counts:Counts={pages:0,cullingNodes:0,groups:0,children:0,outputs:0,roots:0,bundles:0};
 for(const primitive of manifest.primitives){
  counts.pages+=primitive.pages.length;
  counts.cullingNodes+=primitive.culling?.count??0;
  for(const group of primitive.structure?.groups??[]){counts.groups++;counts.children+=group.children.length;counts.outputs+=group.outputs.length;}
  counts.roots+=primitive.structure?.roots.length??0;
  counts.bundles+=primitive.streams?.pages.length??0;
 }
 return counts;
}
function columnElements(name:ColumnName,counts:Counts){
 switch(name){
  case 'pageBounds':case 'pageSphere':case 'pageParentSphere':case 'pageError':case 'pageInt':case 'pageU32':case 'pageSha':
  case 'geometrySha':case 'geometryU32':return counts.pages;
  case 'cullingNodes':return counts.cullingNodes;
  case 'groupLevel':case 'groupError':case 'groupSphere':case 'groupChildCount':case 'groupOutputCount':return counts.groups;
  case 'groupChild':return counts.children;
  case 'groupOutput':return counts.outputs;
  case 'structureRoot':return counts.roots;
  case 'bundleU32':case 'bundleSha':return counts.bundles;
 }
}
function columnBytes(name:ColumnName,counts:Counts){
 return columnElements(name,counts)*COLUMN_STRIDE[name]*BYTES_PER_ELEMENT[COLUMN_KIND[name]];
}

/** Byte ranges of every column, in the fixed order of this version. */
export function manifestBinaryRanges(counts:Counts){
 const ranges:Record<ColumnName,{offset:number;length:number}>={} as Record<ColumnName,{offset:number;length:number}>;
 let offset=align8((MANIFEST_BINARY_HEADER_WORDS+COLUMN_NAMES.length*2)*4);
 for(const name of COLUMN_NAMES){const length=columnBytes(name,counts);ranges[name]={offset,length};offset=align8(offset+length);}
 return {ranges,bytes:offset};
}

/** Splits a manifest into the small JSON a reader parses and the columns it maps. The returned
 *  descriptor carries an empty `sha256`: only the caller, holding the finished bytes, can hash them. */
export function encodeManifestBinary(manifest:ClusterManifest,descriptor:Omit<ManifestBinaryDescriptor,'version'|'sha256'|'bytes'>):{manifest:SlimClusterManifest;binary:Uint8Array}{
 const counts=countManifest(manifest);
 const {ranges,bytes}=manifestBinaryRanges(counts);
 const buffer=new ArrayBuffer(bytes);
 const header=new Uint32Array(buffer,0,MANIFEST_BINARY_HEADER_WORDS+COLUMN_NAMES.length*2);
 header[0]=MANIFEST_BINARY_MAGIC;header[1]=MANIFEST_BINARY_VERSION;header[2]=COLUMN_NAMES.length;header[3]=0;
 COLUMN_NAMES.forEach((name,index)=>{header[MANIFEST_BINARY_HEADER_WORDS+index*2]=ranges[name].offset;header[MANIFEST_BINARY_HEADER_WORDS+index*2+1]=ranges[name].length;});
 const view=<T>(name:ColumnName,make:(b:ArrayBuffer,o:number,n:number)=>T):T=>make(buffer,ranges[name].offset,ranges[name].length/BYTES_PER_ELEMENT[COLUMN_KIND[name]]);
 const bounds=view('pageBounds',(b,o,n)=>new Float64Array(b,o,n)),sphere=view('pageSphere',(b,o,n)=>new Float64Array(b,o,n));
 const parentSphere=view('pageParentSphere',(b,o,n)=>new Float64Array(b,o,n)),error=view('pageError',(b,o,n)=>new Float64Array(b,o,n));
 const ints=view('pageInt',(b,o,n)=>new Int32Array(b,o,n)),words=view('pageU32',(b,o,n)=>new Uint32Array(b,o,n));
 const pageSha=view('pageSha',(b,o,n)=>new Uint8Array(b,o,n)),geometrySha=view('geometrySha',(b,o,n)=>new Uint8Array(b,o,n));
 const geometryWords=view('geometryU32',(b,o,n)=>new Uint32Array(b,o,n));
 const cullingNodes=view('cullingNodes',(b,o,n)=>new Float64Array(b,o,n));
 const groupLevel=view('groupLevel',(b,o,n)=>new Int32Array(b,o,n)),groupError=view('groupError',(b,o,n)=>new Float64Array(b,o,n));
 const groupSphere=view('groupSphere',(b,o,n)=>new Float64Array(b,o,n));
 const groupChildCount=view('groupChildCount',(b,o,n)=>new Int32Array(b,o,n)),groupChild=view('groupChild',(b,o,n)=>new Int32Array(b,o,n));
 const groupOutputCount=view('groupOutputCount',(b,o,n)=>new Int32Array(b,o,n)),groupOutput=view('groupOutput',(b,o,n)=>new Int32Array(b,o,n));
 const structureRoot=view('structureRoot',(b,o,n)=>new Int32Array(b,o,n));
 const bundleWords=view('bundleU32',(b,o,n)=>new Uint32Array(b,o,n)),bundleSha=view('bundleSha',(b,o,n)=>new Uint8Array(b,o,n));
 const writeSha=(target:Uint8Array,slot:number,sha:string)=>{const text=hexDigits(sha);for(let i=0;i<64;i++)target[slot*64+i]=text.charCodeAt(i);};
 const expectTemplate=(template:string,url:string,sha:string)=>{if(template.replace('{sha}',sha)!==url)throw new EngineError('INVALID_CACHE','A cache object url does not follow the manifest template',{url,template});};
 let page=0,node=0,group=0,child=0,output=0,root=0,bundle=0;
 const primitives:SlimPrimitive[]=manifest.primitives.map(primitive=>{
  for(const item of primitive.pages){
   bounds.set(item.min,page*6);bounds.set(item.max,page*6+3);
   let flags=0;
   if(item.role!==undefined){flags|=FLAG_ROLE;if(item.role==='coarse')flags|=FLAG_COARSE;}
   if(typeof item.lodError==='number'&&Array.isArray(item.sphere)){flags|=FLAG_CLUSTER_ERROR;error[page*2]=item.lodError;sphere.set(item.sphere,page*4);}
   if(item.parentError!==undefined){flags|=FLAG_PARENT_ERROR;if(typeof item.parentError==='number'){flags|=FLAG_PARENT_ERROR_FINITE;error[page*2+1]=item.parentError;}}
   if(item.parentSphere!==undefined){flags|=FLAG_PARENT_SPHERE;if(item.parentSphere!==null){flags|=FLAG_PARENT_SPHERE_SET;parentSphere.set(item.parentSphere,page*4);}}
   ints[page*8+INT_ID]=item.id;
   ints[page*8+INT_LEVEL]=item.level??-1;
   if(item.group!==undefined){flags|=FLAG_GROUP;ints[page*8+INT_GROUP]=item.group??-1;}else ints[page*8+INT_GROUP]=-1;
   if(item.source!==undefined){flags|=FLAG_SOURCE;ints[page*8+INT_SOURCE]=item.source??-1;}else ints[page*8+INT_SOURCE]=-1;
   ints[page*8+INT_STREAM]=item.stream??-1;ints[page*8+INT_STREAM_OFFSET]=item.streamOffset??-1;
   ints[page*8+INT_COUNT]=item.count;ints[page*8+INT_START]=item.start??-1;
   words[page*2+U32_BYTES]=item.bytes;
   expectTemplate(descriptor.pageUrl,item.url,item.sha256);
   writeSha(pageSha,page,item.sha256);
   if(item.geometry){
    flags|=FLAG_GEOMETRY;expectTemplate(descriptor.geometryUrl,item.geometry.url,item.geometry.sha256);writeSha(geometrySha,page,item.geometry.sha256);
    geometryWords[page*5]=item.geometry.bytes;geometryWords[page*5+1]=item.geometry.vertexCount;geometryWords[page*5+2]=item.geometry.indexCount;
    geometryWords[page*5+3]=item.geometry.flags;geometryWords[page*5+4]=item.geometry.uncompressedBytes;
   }
   words[page*2+U32_FLAGS]=flags;
   page++;
  }
  if(primitive.culling){cullingNodes.set(primitive.culling.nodes,node*15);node+=primitive.culling.count;}
  for(const item of primitive.structure?.groups??[]){
   groupLevel[group]=item.level;groupError[group]=item.error;groupSphere.set(item.sphere,group*4);
   groupChildCount[group]=item.children.length;groupChild.set(item.children,child);child+=item.children.length;
   groupOutputCount[group]=item.outputs.length;groupOutput.set(item.outputs,output);output+=item.outputs.length;
   group++;
  }
  if(primitive.structure){structureRoot.set(primitive.structure.roots,root);root+=primitive.structure.roots.length;}
  for(const item of primitive.streams?.pages??[]){
   expectTemplate(descriptor.bundleUrl,item.url,item.sha256);writeSha(bundleSha,bundle,item.sha256);
   bundleWords[bundle*2]=item.bytes;bundleWords[bundle*2+1]=item.count;bundle++;
  }
  const {pages,culling,structure,streams,...rest}=primitive;
  const slim:SlimPrimitiveBinary={pages:pages.length};
  if(culling!==undefined)slim.culling=culling===null?null:{stride:culling.stride,count:culling.count};
  if(structure!==undefined)slim.structure=structure===null?null:{version:structure.version,groups:structure.groups.length,roots:structure.roots.length};
  if(streams!==undefined)slim.streams=streams===null?null:{version:streams.version,pinned:streams.pinned,bundleBytes:streams.bundleBytes,pages:streams.pages.length};
  return {...rest,binary:slim} as SlimPrimitive;
 });
 const {primitives:_ignored,...top}=manifest;
 return {manifest:{...top,binary:{...descriptor,version:MANIFEST_BINARY_VERSION,sha256:'',bytes},primitives} as SlimClusterManifest,binary:new Uint8Array(buffer)};
}

/** Rebuilds the `Page` and `Primitive` objects a backend consumes from the columns. */
export function decodeManifestBinary(slim:SlimClusterManifest,buffer:ArrayBuffer):ClusterManifest{
 assertManifestBinary(slim.binary);
 if(buffer.byteLength<(MANIFEST_BINARY_HEADER_WORDS+COLUMN_NAMES.length*2)*4)throw new EngineError('INVALID_CACHE','Manifest binary is shorter than its header',{bytes:buffer.byteLength});
 const header=new Uint32Array(buffer,0,MANIFEST_BINARY_HEADER_WORDS+COLUMN_NAMES.length*2);
 if(header[0]!==MANIFEST_BINARY_MAGIC)throw new EngineError('INVALID_CACHE','Manifest binary has no WGMB signature',{magic:header[0]});
 if(header[1]!==MANIFEST_BINARY_VERSION)throw new EngineError('UNSUPPORTED_FORMAT',`Expected manifest binary version ${MANIFEST_BINARY_VERSION}, received ${header[1]}`,{version:header[1]});
 if(header[2]!==COLUMN_NAMES.length)throw new EngineError('UNSUPPORTED_FORMAT','Manifest binary column count differs from this version',{columns:header[2],expected:COLUMN_NAMES.length});
 const counts:Counts={pages:0,cullingNodes:0,groups:0,children:0,outputs:0,roots:0,bundles:0};
 for(const primitive of slim.primitives){
  const binary=primitive.binary;
  if(!binary||!Number.isSafeInteger(binary.pages)||binary.pages<0)throw new EngineError('INVALID_CACHE','A primitive has no binary page count',{mesh:primitive.mesh,primitive:primitive.primitive});
  counts.pages+=binary.pages;counts.cullingNodes+=binary.culling?.count??0;
  counts.groups+=binary.structure?.groups??0;counts.roots+=binary.structure?.roots??0;counts.bundles+=binary.streams?.pages??0;
 }
 const at=(index:number)=>({offset:header[MANIFEST_BINARY_HEADER_WORDS+index*2],length:header[MANIFEST_BINARY_HEADER_WORDS+index*2+1]});
 const column=<T>(name:ColumnName,make:(b:ArrayBuffer,o:number,n:number)=>T):T=>{
  const index=COLUMN_NAMES.indexOf(name),{offset,length}=at(index);
  const element=BYTES_PER_ELEMENT[COLUMN_KIND[name]];
  if(offset%8!==0||length%element!==0||offset+length>buffer.byteLength)throw new EngineError('INVALID_CACHE',`Manifest binary column ${name} is out of bounds`,{column:name,offset,length,bytes:buffer.byteLength});
  return make(buffer,offset,length/element);
 };
 const expect=(name:ColumnName,elements:number)=>{
  const {length}=at(COLUMN_NAMES.indexOf(name));
  const wanted=elements*COLUMN_STRIDE[name]*BYTES_PER_ELEMENT[COLUMN_KIND[name]];
  if(length!==wanted)throw new EngineError('INVALID_CACHE',`Manifest binary column ${name} does not match the declared counts`,{column:name,length,expected:wanted});
 };
 // The flat child and output arrays are as long as the per-group counts say; everything else is
 // fixed by the counts the small JSON declares, so every column is checked before a byte is read.
 expect('groupChildCount',counts.groups);expect('groupOutputCount',counts.groups);
 const groupChildCount=column('groupChildCount',(b,o,n)=>new Int32Array(b,o,n)),groupOutputCount=column('groupOutputCount',(b,o,n)=>new Int32Array(b,o,n));
 for(let g=0;g<counts.groups;g++){
  if(groupChildCount[g]<0||groupOutputCount[g]<0)throw new EngineError('INVALID_CACHE','A group declares a negative member count',{group:g});
  counts.children+=groupChildCount[g];counts.outputs+=groupOutputCount[g];
 }
 for(const name of COLUMN_NAMES)expect(name,columnElements(name,counts));
 const bounds=column('pageBounds',(b,o,n)=>new Float64Array(b,o,n)),sphere=column('pageSphere',(b,o,n)=>new Float64Array(b,o,n));
 const parentSphere=column('pageParentSphere',(b,o,n)=>new Float64Array(b,o,n)),error=column('pageError',(b,o,n)=>new Float64Array(b,o,n));
 const ints=column('pageInt',(b,o,n)=>new Int32Array(b,o,n)),words=column('pageU32',(b,o,n)=>new Uint32Array(b,o,n));
 const geometryWords=column('geometryU32',(b,o,n)=>new Uint32Array(b,o,n));
 const cullingNodes=column('cullingNodes',(b,o,n)=>new Float64Array(b,o,n));
 const groupLevel=column('groupLevel',(b,o,n)=>new Int32Array(b,o,n)),groupError=column('groupError',(b,o,n)=>new Float64Array(b,o,n));
 const groupSphere=column('groupSphere',(b,o,n)=>new Float64Array(b,o,n));
 const groupChild=column('groupChild',(b,o,n)=>new Int32Array(b,o,n));
 const groupOutput=column('groupOutput',(b,o,n)=>new Int32Array(b,o,n));
 const structureRoot=column('structureRoot',(b,o,n)=>new Int32Array(b,o,n));
 const bundleWords=column('bundleU32',(b,o,n)=>new Uint32Array(b,o,n));
 const decoder=new TextDecoder('latin1');
 const pageShaText=decoder.decode(column('pageSha',(b,o,n)=>new Uint8Array(b,o,n)));
 const geometryShaText=decoder.decode(column('geometrySha',(b,o,n)=>new Uint8Array(b,o,n)));
 const bundleShaText=decoder.decode(column('bundleSha',(b,o,n)=>new Uint8Array(b,o,n)));
 const [pagePrefix,pageSuffix]=slim.binary.pageUrl.split('{sha}');
 const [geometryPrefix,geometrySuffix]=slim.binary.geometryUrl.split('{sha}');
 const [bundlePrefix,bundleSuffix]=slim.binary.bundleUrl.split('{sha}');
 let page=0,node=0,group=0,child=0,output=0,root=0,bundle=0;
 const primitives:Primitive[]=slim.primitives.map(entry=>{
  const binary=entry.binary;
  const pages:Page[]=new Array(binary.pages);
  for(let i=0;i<binary.pages;i++,page++){
   const flags=words[page*2+U32_FLAGS],base=page*8;
   const sha=pageShaText.substring(page*64,page*64+64);
   const item:Page={
    id:ints[base+INT_ID],url:pagePrefix+sha+pageSuffix,sha256:sha,bytes:words[page*2+U32_BYTES],count:ints[base+INT_COUNT],
    min:[bounds[page*6],bounds[page*6+1],bounds[page*6+2]],max:[bounds[page*6+3],bounds[page*6+4],bounds[page*6+5]],
   };
   if(flags&FLAG_ROLE)item.role=flags&FLAG_COARSE?'coarse':'exact';
   if(flags&FLAG_GEOMETRY){
    const geometrySha=geometryShaText.substring(page*64,page*64+64);
    item.geometry={url:geometryPrefix+geometrySha+geometrySuffix,sha256:geometrySha,bytes:geometryWords[page*5],formatVersion:2,codec:'meshopt',
     vertexCount:geometryWords[page*5+1],indexCount:geometryWords[page*5+2],flags:geometryWords[page*5+3],uncompressedBytes:geometryWords[page*5+4]} as GeometryPageDescriptor;
   }
   if(ints[base+INT_START]>=0)item.start=ints[base+INT_START];
   if(ints[base+INT_LEVEL]>=0)item.level=ints[base+INT_LEVEL];
   if(flags&FLAG_CLUSTER_ERROR){item.lodError=error[page*2];item.sphere=[sphere[page*4],sphere[page*4+1],sphere[page*4+2],sphere[page*4+3]];}
   if(flags&FLAG_PARENT_ERROR)item.parentError=flags&FLAG_PARENT_ERROR_FINITE?error[page*2+1]:null;
   if(flags&FLAG_PARENT_SPHERE)item.parentSphere=flags&FLAG_PARENT_SPHERE_SET?[parentSphere[page*4],parentSphere[page*4+1],parentSphere[page*4+2],parentSphere[page*4+3]]:null;
   if(flags&FLAG_GROUP)item.group=ints[base+INT_GROUP]>=0?ints[base+INT_GROUP]:null;
   if(flags&FLAG_SOURCE)item.source=ints[base+INT_SOURCE]>=0?ints[base+INT_SOURCE]:null;
   if(ints[base+INT_STREAM]>=0){item.stream=ints[base+INT_STREAM];item.streamOffset=ints[base+INT_STREAM_OFFSET];}
   pages[i]=item;
  }
  let culling:CullingHierarchy|null|undefined;
  if(binary.culling!==undefined){
   if(binary.culling===null)culling=null;
   else{
    const {stride,count}=binary.culling;
    if(stride!==15)throw new EngineError('UNSUPPORTED_FORMAT','Manifest binary culling stride differs from this version',{stride});
    culling={stride,count,nodes:Array.from(cullingNodes.subarray(node*15,(node+count)*15))};
    node+=count;
   }
  }
  let structure:ClusterStructure|null|undefined;
  if(binary.structure!==undefined){
   if(binary.structure===null)structure=null;
   else{
    const groups:ClusterGroup[]=new Array(binary.structure.groups);
    for(let g=0;g<binary.structure.groups;g++,group++){
     const children=Array.from(groupChild.subarray(child,child+groupChildCount[group]));child+=groupChildCount[group];
     const outputs=Array.from(groupOutput.subarray(output,output+groupOutputCount[group]));output+=groupOutputCount[group];
     groups[g]={level:groupLevel[group],error:groupError[group],sphere:[groupSphere[group*4],groupSphere[group*4+1],groupSphere[group*4+2],groupSphere[group*4+3]],children,outputs};
    }
    structure={version:binary.structure.version,roots:Array.from(structureRoot.subarray(root,root+binary.structure.roots)),groups};
    root+=binary.structure.roots;
   }
  }
  let streams:StreamCatalogue|null|undefined;
  if(binary.streams!==undefined){
   if(binary.streams===null)streams=null;
   else{
    const list:StreamBundle[]=new Array(binary.streams.pages);
    for(let b=0;b<binary.streams.pages;b++,bundle++){
     const sha=bundleShaText.substring(bundle*64,bundle*64+64);
     list[b]={url:bundlePrefix+sha+bundleSuffix,sha256:sha,bytes:bundleWords[bundle*2],count:bundleWords[bundle*2+1]};
    }
    streams={version:binary.streams.version,pinned:binary.streams.pinned,bundleBytes:binary.streams.bundleBytes,pages:list};
   }
  }
  const {binary:_ignored,...rest}=entry;
  const result={...rest,pages} as Primitive;
  if(culling!==undefined)result.culling=culling;
  if(structure!==undefined)result.structure=structure;
  if(streams!==undefined)result.streams=streams;
  return result;
 });
 const {binary:_descriptor,primitives:_slimPrimitives,...top}=slim;
 return {...top,primitives} as ClusterManifest;
}
