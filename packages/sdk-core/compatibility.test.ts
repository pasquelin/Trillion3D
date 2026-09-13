import test from 'node:test';import assert from 'node:assert/strict';
import {assertFormat,assertCacheIdentity,DAG_ERROR_MODEL,EngineError,FORMAT_VERSION,LOD_ERROR_MODEL,compareImages,pageCarriesClusterError,primitiveUsesClusterErrors} from './index.ts';
test('Public core imports without DOM and rejects unknown format with a structured code',()=>{assert.equal(typeof (globalThis as {document?:unknown}).document,'undefined');assertFormat(FORMAT_VERSION);assert.throws(()=>assertFormat(999),(error:unknown)=>error instanceof EngineError&&error.code==='UNSUPPORTED_FORMAT');assert.equal(compareImages(new Uint8Array([1,2,3,255]),new Uint8Array([1,2,3,255])).differentPixels,0);});
test('a simplified cache without the current error model is rejected',()=>{
 const base={schema:1,status:'ready',key:'k',scope:'slice' as const,sourceTriangles:1,selectedTriangles:1,selectedNodes:[0],totalNodes:1,primitives:[{mesh:0,primitive:0,pass:'exact-clusters',pages:[{id:0,url:'0',sha256:'x',bytes:12,count:3,min:[0,0,0],max:[1,1,1],role:'coarse' as const}],hierarchy:{min:[0,0,0],max:[1,1,1],errorObject:0,coarsePages:[0]}}]};
 for(const pass of ['exact-clusters','clustered-blend']){
  const metadata={...base,schema:pass==='clustered-blend'?2:1,primitives:base.primitives.map(primitive=>({...primitive,pass}))};
  assert.throws(()=>assertCacheIdentity(metadata),(error:unknown)=>error instanceof EngineError&&error.code==='STALE_CACHE');
  assertCacheIdentity({...metadata,errorModel:LOD_ERROR_MODEL});
 }
});
test('cache readers accept historical format 1 and clustered BLEND format 2 explicitly',()=>{
 assertFormat(1);assertFormat(2);
 for(const version of [0,3,999])assert.throws(()=>assertFormat(version),(error:unknown)=>error instanceof EngineError&&error.code==='UNSUPPORTED_FORMAT');
 const blend={schema:2,formatVersion:2,status:'ready',key:'blend-v2',scope:'full' as const,sourceTriangles:1,selectedTriangles:1,selectedNodes:[0],totalNodes:1,primitives:[{mesh:0,primitive:0,pass:'clustered-blend',pages:[],hierarchy:null}]};
 assertCacheIdentity(blend);
 assert.throws(()=>assertCacheIdentity({...blend,schema:1,formatVersion:1}),(error:unknown)=>error instanceof EngineError&&error.code==='UNSUPPORTED_FORMAT');
});
test('a cache whose pages carry their own cluster errors requires the DAG error model',()=>{
 const page=(id:number,level:number,lodError:number,sphere:number[],parentError:number|null,parentSphere:number[]|null)=>({
  id,url:`${id}`,sha256:'x',bytes:12,count:3,min:[0,0,0],max:[1,1,1],
  role:(level?'coarse':'exact') as 'exact'|'coarse',level,lodError,sphere,parentError,parentSphere,
 });
 const metadata={schema:1,status:'ready',key:'k',scope:'full' as const,sourceTriangles:2,selectedTriangles:2,selectedNodes:[0],totalNodes:1,
  primitives:[{mesh:0,primitive:0,pass:'exact-clusters',clusterStrategy:'dag-groups' as const,hierarchy:null,
   pages:[page(0,0,0,[0,0,0,1],0.5,[0,0,0,2]),page(1,1,0.5,[0,0,0,2],null,null)]}]};
 assert.throws(()=>assertCacheIdentity(metadata),(error:unknown)=>error instanceof EngineError&&error.code==='STALE_CACHE');
 assert.throws(()=>assertCacheIdentity({...metadata,errorModel:LOD_ERROR_MODEL}),(error:unknown)=>error instanceof EngineError&&error.code==='STALE_CACHE');
 assertCacheIdentity({...metadata,errorModel:DAG_ERROR_MODEL});
 assert.equal(primitiveUsesClusterErrors(metadata.primitives[0]),true);
 assert.equal(pageCarriesClusterError({...metadata.primitives[0].pages[0],sphere:undefined}),false);
});
