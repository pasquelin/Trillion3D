export const SDK_VERSION='0.1.0';
export const FORMAT_VERSION=1;
/** Cache identity for the conservative object-space LOD distance bound and boundary validation. */
export const LOD_ERROR_MODEL='bounds-diagonal-boundary-v1';
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
export interface Page { id:number; url:string; sha256:string; bytes:number; count:number; min:number[];max:number[];role?:'exact'|'coarse';geometry?:GeometryPageDescriptor }
export interface Tree { min:number[];max:number[];page?:number;children?:Tree[];errorObject?:number;coarsePages?:number[] }
export interface Primitive {mesh:number;primitive:number;pass:string;pages:Page[];hierarchy:Tree|null;topology?:{triangles:number;edges:{boundary:number;manifold:number;nonManifold:number};vertices:{interior:number;boundary:number;locked:number;unused:number};manifold:boolean}}
export interface ClusterManifest {formatVersion?:number;compilerVersion?:string;errorModel?:string;simplification?:boolean;schema:number;status:string;key:string;scope:AssetScope;clusterStrategy?:string;sourceTriangles:number;selectedTriangles:number;selectedNodes:number[];totalNodes:number;autonomousScene?:string|null;primitives:Primitive[]}

export class EngineError extends Error { readonly code:string; readonly details:Record<string,unknown>; constructor(code:string,message:string,details:Record<string,unknown>={}){super(message);this.name='EngineError';this.code=code;this.details=details;} }
export interface PageSource {read(key:string,signal?:AbortSignal):Promise<Uint8Array>}
export function assertFormat(formatVersion:number){if(formatVersion!==FORMAT_VERSION)throw new EngineError('UNSUPPORTED_FORMAT',`Expected format ${FORMAT_VERSION}, received ${formatVersion}`,{formatVersion});}
function cacheUsesLodError(metadata:ClusterManifest){
 if(metadata.simplification)return true;
 return metadata.primitives.some(primitive=>primitive.pages.some(page=>(page.role??'exact')==='coarse')||primitive.hierarchy?.errorObject!=null);
}
/** Rejects caches compiled before the certified conservative error identity. */
export function assertCacheIdentity(metadata:ClusterManifest){
 assertFormat(metadata.formatVersion??metadata.schema);
 if(!cacheUsesLodError(metadata))return;
 if(metadata.errorModel!==LOD_ERROR_MODEL){
  throw new EngineError('STALE_CACHE',`Cache error model ${metadata.errorModel??'absent'} cannot be used; recompile with ${LOD_ERROR_MODEL}`,{errorModel:metadata.errorModel??null,expected:LOD_ERROR_MODEL});
 }
}
