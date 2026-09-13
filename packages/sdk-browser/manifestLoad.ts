import {assertCacheIdentity,assertFormat,assertManifestBinary,decodeManifestBinary,EngineError,isBinaryManifest,type AssetScope,type ClusterManifest,type SlimClusterManifest} from '../sdk-core/index.ts';
import {checked} from './clusterPages.ts';

export async function jsonResource(url:string,signal?:AbortSignal):Promise<{value:Record<string,unknown>;details:{url:string;status:number;contentType:string};bytes:number}>{
 const response=await checked(url,signal),contentType=response.headers.get('content-type')??'';
 const details={url,status:response.status,contentType};
 if(!/^application\/(?:[\w.-]+\+)?json(?:;|$)/i.test(contentType))throw new EngineError('INVALID_JSON_RESPONSE',`${url}: JSON attendu, HTTP ${response.status}, type ${contentType||'absent'}`,details);
 // `response.json()` parses the bytes without ever materialising the text; the declared length is
 // enough for the diagnostic, and reading the body twice to count would cost more than it reports.
 const declared=Number(response.headers.get('content-length'));
 let value:unknown;try{value=await response.json();}catch{throw new EngineError('INVALID_JSON_RESPONSE',`${url}: JSON invalide, HTTP ${response.status}, type ${contentType}`,details);}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new EngineError('INVALID_JSON_RESPONSE',`${url}: objet JSON attendu, HTTP ${response.status}, type ${contentType}`,details);
 return {value:value as Record<string,unknown>,details,bytes:Number.isFinite(declared)?declared:0};
}

/** What the manifest cost to obtain. Reported as a diagnostic so a campaign can measure it. */
export interface ManifestTiming {format:'json'|'binary';jsonBytes:number;binaryBytes:number;pointerMs:number;jsonMs:number;binaryMs:number;decodeMs:number;totalMs:number}
export interface LoadedManifest {pointer:Record<string,unknown>;metadata:ClusterManifest;metadataUrl:string;base:string;timing:ManifestTiming}

/**
 * Reads the preparation pointer, then the cache it names.
 *
 * A cache compiled with a binary sidecar hands over a small JSON and a column file: the columns are
 * mapped, never parsed, so the cost of reading a manifest stops growing with the cluster count. A
 * cache without one is read exactly as before, so older caches stay loadable.
 */
export async function loadClusterManifest(manifestUrl:string,scope:AssetScope,signal?:AbortSignal):Promise<LoadedManifest>{
 const started=performance.now();
 const pointerResource=await jsonResource(manifestUrl,signal),pointer=pointerResource.value;
 const pointerMs=performance.now()-started;
 if(typeof pointer.status!=='string'||typeof pointer.url!=='string'||!pointer.url)throw new EngineError('INVALID_POINTER',`${manifestUrl}: manifeste sans status/url valides, HTTP ${pointerResource.details.status}, type ${pointerResource.details.contentType}`,pointerResource.details);
 if(pointer.status!=='ready')throw new EngineError('CACHE_NOT_READY','The preparation pointer is not ready');
 if(pointer.scope!==undefined&&pointer.scope!==scope)throw new EngineError('SCOPE_MISMATCH',`Requested ${scope}, pointer contains ${pointer.scope}`,{requestedScope:scope,pointerScope:pointer.scope});
 if(pointer.formatVersion!==undefined)assertFormat(pointer.formatVersion as number);
 const metadataUrl=new URL(pointer.url,new URL(manifestUrl,location.href)).href;
 const jsonStart=performance.now();
 const metadataResource=await jsonResource(metadataUrl,signal),value=metadataResource.value;
 const jsonMs=performance.now()-jsonStart;
 if(!Array.isArray(value.primitives)||!Array.isArray(value.selectedNodes)||typeof value.selectedTriangles!=='number')throw new EngineError('INVALID_CACHE',`${metadataUrl}: schéma du cache invalide, HTTP ${metadataResource.details.status}, type ${metadataResource.details.contentType}`,metadataResource.details);
 let metadata:ClusterManifest,binaryBytes=0,binaryMs=0,decodeMs=0,format:'json'|'binary'='json';
 if(isBinaryManifest(value)){
  format='binary';
  assertManifestBinary(value.binary);
  const binaryUrl=new URL((value.binary as {url:string}).url,metadataUrl).href;
  const binaryStart=performance.now();
  const buffer=await(await checked(binaryUrl,signal)).arrayBuffer();
  binaryMs=performance.now()-binaryStart;binaryBytes=buffer.byteLength;
  const declared=(value.binary as {bytes:number}).bytes;
  if(buffer.byteLength!==declared)throw new EngineError('INVALID_CACHE',`${binaryUrl}: ${buffer.byteLength} octets reçus, ${declared} annoncés`,{url:binaryUrl,bytes:buffer.byteLength,expected:declared});
  const decodeStart=performance.now();
  metadata=decodeManifestBinary(value as unknown as SlimClusterManifest,buffer);
  decodeMs=performance.now()-decodeStart;
 }else metadata=value as unknown as ClusterManifest;
 assertFormat(metadata.formatVersion??metadata.schema);
 assertCacheIdentity(metadata);
 if(metadata.status!=='ready')throw new EngineError('INVALID_CACHE','Unsupported Web Geometry cache');
 if(metadata.scope!==scope)throw new EngineError('SCOPE_MISMATCH',`Requested ${scope}, cache contains ${metadata.scope}`,{requestedScope:scope,cacheScope:metadata.scope});
 const base=new URL('.',new URL(pointer.url,new URL(manifestUrl,location.href))).href;
 return {pointer,metadata,metadataUrl,base,
  timing:{format,jsonBytes:metadataResource.bytes,binaryBytes,pointerMs,jsonMs,binaryMs,decodeMs,totalMs:performance.now()-started}};
}
