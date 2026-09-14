export const SDK_VERSION='0.1.0';
export const FORMAT_VERSION=1;
/** Outer cache format required for clustered BLEND; source manifests remain format 1. */
export const CLUSTERED_BLEND_FORMAT_VERSION=2;
/** Cache identity for per-cluster DAG errors: group QEM error projected through the group sphere. */
export const DAG_ERROR_MODEL='dag-group-qem-v1';
export const DEFAULT_SCOPE:AssetScope='slice';
export type AssetScope = 'slice' | 'full';
export interface PreparationProgress { phase:string; completed:number; total:number; message:string }
export interface CameraPose { position:[number,number,number]; target:[number,number,number]; fov:number; near:number; far:number }
export interface StablePreview { scope:AssetScope; origin:'bottom-left'|'top-left'; rgba:Uint8Array; width:number; height:number; backend:string }
/** One timed GPU pass. `gpuMs` is null when the device returned no usable pair of timestamps. */
export interface GpuPassTiming { name:string; gpuMs:number|null; reason?:string }
/**
 * GPU durations of one image, pass by pass, as the device itself reported them. `totalMs` is the sum
 * of the listed passes and nothing else: it is never added to a `cpu*` field, and it is null as soon
 * as one pass is unmeasured or the list was truncated. `frame` names the image the sample describes,
 * which lags the current one because the readback never blocks an image.
 */
export interface GpuPassTimings { frame:number; totalMs:number|null; passes:GpuPassTiming[]; truncated:boolean; error?:string }
export interface FrameMetrics {
 rafIntervalMs:number|null; cpuFrameMs:number; cpuSubmitMs:number|null; gpuMs:number|null; drawCalls:number; triangles:number; clusters:number|null; selectedTriangles:number|null; residentPages:number|null; submittedTriangles?:number|null;
 /** All submitted triangles, including transparent passes. Null when a backend cannot count them. */
 totalSubmittedTriangles?:number|null;
 /** Clusters that left the drawn cut this session. A moving camera detaches clusters every frame;
  *  this is not a cache pressure signal. Null on a backend that does not track a cut. */
 pagesDetached?:number|null;
 /** Pages actually evicted from the cache that feeds the drawn geometry: the backend's own GPU page
  *  cache when it owns one, the host page streamer otherwise. This is the cache pressure signal. */
 cacheEvictions?:number|null;
 geometryAllocationBytes:number|null; vramBytes:number|null; pageLoads:number; pageBytesRead:number;
 pagesRequested?:number|null; pagesLoading?:number|null; cacheHits?:number|null; cacheMisses?:number|null; frustumRejected?:number|null; lodLevel?:number|null;
 /** WebGPU transparent submission counters, including both draws for two-pass materials. Null when unavailable. */
 transparentMeshes?:number|null; transparentFrustumRejected?:number|null; transparentDrawCalls?:number|null; transparentSubmittedTriangles?:number|null;
 /** Complete initial GPU fallback is available; null on backends without this guarantee. */
 coverageReady?:boolean|null;
 /** Requested detail cannot coexist with the pinned fallback within the GPU page budget. */
 coverageBudgetLimited?:boolean|null;
 /** Sticky loading error; failed URLs require an explorer reload after three attempts. */
 streamingError?:string|null;
 textureUploaded?:number|null;texturePending?:number|null;textureSkipped?:number|null;
 /** Latest GPU pass sample of this backend; null when the device exposes no timestamp queries. */
 gpuPassMs?:GpuPassTimings|null;
}
export interface BackendCapabilities { renderer:string; materials:string; hierarchy:boolean; gpuDriven:boolean; simplification:boolean; eviction:boolean; unsupported:string[] }
export interface GeometryPageDescriptor {url:string;sha256:string;bytes:number;formatVersion:2;codec:'meshopt';vertexCount:number;indexCount:number;flags:number;uncompressedBytes:number}
export interface Page {
 id:number; url:string; sha256:string; bytes:number; count:number; min:number[];max:number[];role?:'exact'|'coarse';geometry?:GeometryPageDescriptor;
 /** Offset of the earliest source index this page descends from. Restores a transparent draw order. */
 start?:number;
 /** DAG cut, when the compiler emitted one. `lodError` is the object-space error of the group that
  *  produced this cluster, projected through `sphere`; `parentError` is the error of the group that
  *  replaces it, projected through `parentSphere`. Both are null on a root, which is never replaced. */
 level?:number; lodError?:number; sphere?:number[]; parentError?:number|null; parentSphere?:number[]|null;
 /** Group that replaces this cluster (null on a root) and group that produced it (null at level 0).
  *  Coarsening is a group-wide swap, so a runtime short of memory needs both links. */
 group?:number|null; source?:number|null;
 /** Streaming bundle holding this cluster and its byte offset inside it. One request serves dozens
  *  of clusters; the cluster stays readable on its own through `url`. */
 stream?:number; streamOffset?:number;
}
/** A cluster carrying its own screen-error band needs no hierarchy: selection is a flat per-page test. */
export function pageCarriesClusterError(page:Page){
 return typeof page.lodError==='number'&&Number.isFinite(page.lodError)&&page.lodError>=0&&Array.isArray(page.sphere)&&page.sphere.length===4&&page.sphere.every(value=>Number.isFinite(value))&&page.sphere[3]>=0;
}
export function primitiveUsesClusterErrors(primitive:Pick<Primitive,'pages'>){
 return primitive.pages.length>0&&primitive.pages.every(pageCarriesClusterError);
}
/** Flat culling hierarchy over a primitive's clusters. `stride` numbers per node, node 0 is the root:
 *  min[3], max[3], sphere[4], maxParentError (-1 when the subtree holds a cluster with no
 *  replacement), firstChild, childCount, firstPage, pageCount. A leaf has childCount 0. */
export interface CullingHierarchy {stride:number;count:number;nodes:number[]}
/** One reduction of the cluster DAG. `children` and `outputs` cover the same surface, never both. */
export interface ClusterGroup {level:number;error:number;sphere:number[];children:number[];outputs:number[]}
/** Group links of a primitive, plus the clusters that nothing replaces. */
export interface ClusterStructure {version:number;roots:number[];groups:ClusterGroup[]}
export interface StreamBundle {url:string;sha256:string;bytes:number;count:number}
/** Streaming bundles of a primitive. The first `pinned` bundles hold exactly the root clusters,
 *  so keeping them resident guarantees a complete, if coarse, cover of the primitive. */
export interface StreamCatalogue {version:number;pinned:number;bundleBytes:number;pages:StreamBundle[]}
export interface Primitive {mesh:number;primitive:number;pass:string;clusterStrategy?:'dag-groups';pages:Page[];culling?:CullingHierarchy|null;structure?:ClusterStructure|null;streams?:StreamCatalogue|null;topology?:{triangles:number;edges:{boundary:number;manifold:number;nonManifold:number};vertices:{interior:number;boundary:number;locked:number;unused:number};manifold:boolean}}
export interface ClusterManifest {formatVersion?:number;compilerVersion?:string;errorModel?:string;simplification?:boolean;schema:number;status:string;key:string;scope:AssetScope;clusterStrategy?:string;sourceTriangles:number;selectedTriangles:number;selectedNodes:number[];totalNodes:number;autonomousScene?:string|null;primitives:Primitive[]}

export class EngineError extends Error { readonly code:string; readonly details:Record<string,unknown>; constructor(code:string,message:string,details:Record<string,unknown>={}){super(message);this.name='EngineError';this.code=code;this.details=details;} }
export interface PageSource {read(key:string,signal?:AbortSignal):Promise<Uint8Array>}
export function assertFormat(formatVersion:number){if(formatVersion!==FORMAT_VERSION&&formatVersion!==CLUSTERED_BLEND_FORMAT_VERSION)throw new EngineError('UNSUPPORTED_FORMAT',`Expected cache format 1 or 2, received ${formatVersion}`,{formatVersion});}

/**
 * What a host can check on a preparation pointer, before it knows anything about clusters: the
 * preparation is finished, it carries the scope that was asked for, and its format is one this SDK
 * reads. Returns the cache manifest URL the pointer names, to be resolved against the pointer URL.
 * A host has no business reading these fields itself; this is the check the reader runs.
 */
export function assertCachePointer(pointer:unknown,scope:AssetScope):string{
 if(!pointer||typeof pointer!=='object'||Array.isArray(pointer))throw new EngineError('INVALID_POINTER','preparation pointer is not a JSON object',{});
 const value=pointer as Record<string,unknown>;
 if(typeof value.status!=='string'||typeof value.url!=='string'||!value.url)throw new EngineError('INVALID_POINTER','preparation pointer carries no valid status/url',{status:value.status??null,url:value.url??null});
 if(value.status!=='ready')throw new EngineError('CACHE_NOT_READY','The preparation pointer is not ready',{status:value.status});
 if(value.scope!==undefined&&value.scope!==scope)throw new EngineError('SCOPE_MISMATCH',`Requested ${scope}, pointer contains ${value.scope}`,{requestedScope:scope,pointerScope:value.scope});
 if(value.formatVersion!==undefined)assertFormat(value.formatVersion as number);
 return value.url;
}
/**
 * What a host can check on the cache manifest alone, whether its clusters are written inline or in a
 * binary sidecar: the cache is ready, of the requested scope, in a format this SDK reads, and
 * declares the geometry it selected. Returns that triangle count, so an availability probe needs to
 * read nothing else and needs to know no field name.
 *
 * The identity of the clusters themselves is `assertCacheIdentity`: it reads the pages, so it runs
 * on a decoded manifest, which a probe deliberately does not download.
 */
export function assertCacheReady(metadata:unknown,scope:AssetScope):number{
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw new EngineError('INVALID_CACHE','cache manifest is not a JSON object',{});
 const value=metadata as Record<string,unknown>;
 if(!Array.isArray(value.primitives)||!Array.isArray(value.selectedNodes)||typeof value.selectedTriangles!=='number'||!Number.isFinite(value.selectedTriangles))throw new EngineError('INVALID_CACHE','invalid cache schema',{});
 const formatVersion=(value.formatVersion??value.schema) as number;
 assertFormat(formatVersion);
 if(value.schema!==formatVersion)throw new EngineError('UNSUPPORTED_FORMAT','Cache schema and formatVersion differ',{schema:value.schema,formatVersion});
 if(value.status!=='ready')throw new EngineError('INVALID_CACHE','Unsupported Web Geometry cache',{status:value.status??null});
 if(value.scope!==scope)throw new EngineError('SCOPE_MISMATCH',`Requested ${scope}, cache contains ${value.scope}`,{requestedScope:scope,cacheScope:value.scope});
 // The one identity statement a slim manifest can make on its own: a DAG cache names the model its
 // clusters were certified with. Older caches name neither and stay readable.
 if(value.clusterStrategy==='dag-groups'&&value.errorModel!==DAG_ERROR_MODEL)throw new EngineError('STALE_CACHE',`Cache error model ${value.errorModel??'absent'} cannot be used; recompile with ${DAG_ERROR_MODEL}`,{errorModel:value.errorModel??null,expected:DAG_ERROR_MODEL});
 return value.selectedTriangles;
}
/**
 * Rejects any cache this runtime cannot draw. The runtime reads one geometry model: a DAG of
 * clusters where every cluster carries its own screen-error band. A cache whose clusters carry no
 * band — the old page tree — is refused by name here rather than half-read later.
 */
export function assertCacheIdentity(metadata:ClusterManifest){
 // A manifest with a binary sidecar describes its clusters in columns; identity is a property of
 // the decoded pages, so decoding comes first and strips the pointer.
 if((metadata as unknown as {binary?:unknown}).binary)throw new EngineError('INVALID_CACHE','A manifest with a binary sidecar must be decoded before its identity is checked',{});
 const formatVersion=metadata.formatVersion??metadata.schema;assertFormat(formatVersion);
 if(metadata.schema!==formatVersion)throw new EngineError('UNSUPPORTED_FORMAT','Cache schema and formatVersion differ',{schema:metadata.schema,formatVersion});
 if(formatVersion!==CLUSTERED_BLEND_FORMAT_VERSION&&metadata.primitives.some(primitive=>primitive.pass==='clustered-blend'))throw new EngineError('UNSUPPORTED_FORMAT','clustered-blend requires cache format 2',{formatVersion});
 const missing=metadata.primitives.findIndex(primitive=>!primitiveUsesClusterErrors(primitive));
 if(missing>=0){
  const primitive=metadata.primitives[missing];
  throw new EngineError('STALE_CACHE',`Cache without a cluster DAG cannot be used: primitive ${primitive.mesh}/${primitive.primitive} has no per-cluster error band; recompile with ${DAG_ERROR_MODEL}`,
   {mesh:primitive.mesh,primitive:primitive.primitive,errorModel:metadata.errorModel??null,expected:DAG_ERROR_MODEL});
 }
 if(metadata.errorModel!==DAG_ERROR_MODEL)throw new EngineError('STALE_CACHE',`Cache error model ${metadata.errorModel??'absent'} cannot be used; recompile with ${DAG_ERROR_MODEL}`,{errorModel:metadata.errorModel??null,expected:DAG_ERROR_MODEL});
}
