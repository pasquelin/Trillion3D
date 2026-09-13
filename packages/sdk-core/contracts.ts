export const SDK_VERSION='0.1.0';
export const FORMAT_VERSION=1;
/** Outer cache format required for clustered BLEND; source manifests remain format 1. */
export const CLUSTERED_BLEND_FORMAT_VERSION=2;
/** Cache identity for the conservative object-space LOD distance bound and boundary validation. */
export const LOD_ERROR_MODEL='bounds-diagonal-boundary-v1';
/** Cache identity for per-cluster DAG errors: group QEM error projected through the group sphere. */
export const DAG_ERROR_MODEL='dag-group-qem-v1';
export const DEFAULT_SCOPE:AssetScope='slice';
export type AssetScope = 'slice' | 'full';
export interface PreparationProgress { phase:string; completed:number; total:number; message:string }
export interface CameraPose { position:[number,number,number]; target:[number,number,number]; fov:number; near:number; far:number }
export interface StablePreview { scope:AssetScope; origin:'bottom-left'|'top-left'; rgba:Uint8Array; width:number; height:number; backend:string }
export interface FrameMetrics {
 rafIntervalMs:number|null; cpuFrameMs:number; cpuSubmitMs:number|null; gpuMs:number|null; drawCalls:number; triangles:number; clusters:number|null; selectedTriangles:number|null; residentPages:number|null; submittedTriangles?:number|null;
 /** All submitted triangles, including transparent passes. Null when a backend cannot count them. */
 totalSubmittedTriangles?:number|null;
 pageEvictions?:number|null; geometryAllocationBytes:number|null; vramBytes:number|null; pageLoads:number; pageBytesRead:number;
 pagesRequested?:number|null; pagesLoading?:number|null; cacheHits?:number|null; cacheMisses?:number|null; frustumRejected?:number|null; lodLevel?:number|null; hizRejected?:number|null;
 /** WebGPU transparent submission counters, including both draws for two-pass materials. Null when unavailable. */
 transparentMeshes?:number|null; transparentFrustumRejected?:number|null; transparentDrawCalls?:number|null; transparentSubmittedTriangles?:number|null;
 /** Complete initial GPU fallback is available; null on backends without this guarantee. */
 coverageReady?:boolean|null;
 /** Requested detail cannot coexist with the pinned fallback within the GPU page budget. */
 coverageBudgetLimited?:boolean|null;
 /** Sticky loading error; failed URLs require an explorer reload after three attempts. */
 streamingError?:string|null;
 textureUploaded?:number|null;texturePending?:number|null;textureSkipped?:number|null;
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
export interface Tree { min:number[];max:number[];page?:number;children?:Tree[];errorObject?:number;coarsePages?:number[] }
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
export interface Primitive {mesh:number;primitive:number;pass:string;clusterStrategy?:'exact-source-order'|'greedy-adjacency'|'dag-groups';pages:Page[];hierarchy:Tree|null;culling?:CullingHierarchy|null;structure?:ClusterStructure|null;streams?:StreamCatalogue|null;topology?:{triangles:number;edges:{boundary:number;manifold:number;nonManifold:number};vertices:{interior:number;boundary:number;locked:number;unused:number};manifold:boolean}}
export interface ClusterManifest {formatVersion?:number;compilerVersion?:string;errorModel?:string;simplification?:boolean;schema:number;status:string;key:string;scope:AssetScope;clusterStrategy?:string;sourceTriangles:number;selectedTriangles:number;selectedNodes:number[];totalNodes:number;autonomousScene?:string|null;primitives:Primitive[]}

export class EngineError extends Error { readonly code:string; readonly details:Record<string,unknown>; constructor(code:string,message:string,details:Record<string,unknown>={}){super(message);this.name='EngineError';this.code=code;this.details=details;} }
export interface PageSource {read(key:string,signal?:AbortSignal):Promise<Uint8Array>}
export function assertFormat(formatVersion:number){if(formatVersion!==FORMAT_VERSION&&formatVersion!==CLUSTERED_BLEND_FORMAT_VERSION)throw new EngineError('UNSUPPORTED_FORMAT',`Expected cache format 1 or 2, received ${formatVersion}`,{formatVersion});}
function cacheUsesLodError(metadata:ClusterManifest){
 if(metadata.simplification)return true;
 return metadata.primitives.some(primitive=>primitive.pages.some(page=>(page.role??'exact')==='coarse')||primitive.hierarchy?.errorObject!=null);
}
function cacheUsesClusterErrors(metadata:ClusterManifest){return metadata.primitives.some(primitiveUsesClusterErrors);}
/** Rejects caches compiled before the certified conservative error identity. */
export function assertCacheIdentity(metadata:ClusterManifest){
 const formatVersion=metadata.formatVersion??metadata.schema;assertFormat(formatVersion);
 if(metadata.schema!==formatVersion)throw new EngineError('UNSUPPORTED_FORMAT','Cache schema and formatVersion differ',{schema:metadata.schema,formatVersion});
 if(formatVersion!==CLUSTERED_BLEND_FORMAT_VERSION&&metadata.primitives.some(primitive=>primitive.pass==='clustered-blend'))throw new EngineError('UNSUPPORTED_FORMAT','clustered-blend requires cache format 2',{formatVersion});
 const dagPages=cacheUsesClusterErrors(metadata);
 if(!dagPages&&!cacheUsesLodError(metadata))return;
 const expected=dagPages?DAG_ERROR_MODEL:LOD_ERROR_MODEL;
 if(metadata.errorModel!==expected){
  throw new EngineError('STALE_CACHE',`Cache error model ${metadata.errorModel??'absent'} cannot be used; recompile with ${expected}`,{errorModel:metadata.errorModel??null,expected});
 }
}
