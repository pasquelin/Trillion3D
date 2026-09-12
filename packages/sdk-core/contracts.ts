export const SDK_VERSION='0.1.0';
export const FORMAT_VERSION=1;
export const DEFAULT_SCOPE:AssetScope='slice';
export type AssetScope = 'slice' | 'full';
export interface PreparationProgress { phase:string; completed:number; total:number; message:string }
export interface CameraPose { position:[number,number,number]; target:[number,number,number]; fov:number; near:number; far:number }
export interface StablePreview { scope:AssetScope; origin:'bottom-left'|'top-left'; rgba:Uint8Array; width:number; height:number; backend:string }
export interface FrameMetrics {
 rafIntervalMs:number|null; cpuFrameMs:number; cpuSubmitMs:number|null; gpuMs:number|null; drawCalls:number; triangles:number; clusters:number|null; selectedTriangles:number|null; residentPages:number|null; submittedTriangles?:number|null;
 pageEvictions?:number|null; geometryAllocationBytes:number|null; vramBytes:number|null; pageLoads:number; pageBytesRead:number;
 pagesRequested?:number|null; pagesLoading?:number|null; cacheHits?:number|null; cacheMisses?:number|null; frustumRejected?:number|null; lodLevel?:number|null; hizRejected?:number|null;
}
export interface BackendCapabilities { renderer:string; materials:string; hierarchy:boolean; gpuDriven:boolean; simplification:boolean; eviction:boolean; unsupported:string[] }
export interface Page { id:number; url:string; sha256:string; bytes:number; count:number; min:number[];max:number[];role?:'exact'|'coarse' }
export interface Tree { min:number[];max:number[];page?:number;children?:Tree[];errorObject?:number;coarsePages?:number[] }
export interface Primitive {mesh:number;primitive:number;pass:string;pages:Page[];hierarchy:Tree|null;topology?:{triangles:number;edges:{boundary:number;manifold:number;nonManifold:number};vertices:{interior:number;boundary:number;locked:number;unused:number};manifold:boolean}}
export interface ClusterManifest {formatVersion?:number;compilerVersion?:string;schema:number;status:string;key:string;scope:AssetScope;clusterStrategy?:string;sourceTriangles:number;selectedTriangles:number;selectedNodes:number[];totalNodes:number;primitives:Primitive[]}

export class EngineError extends Error { readonly code:string; readonly details:Record<string,unknown>; constructor(code:string,message:string,details:Record<string,unknown>={}){super(message);this.name='EngineError';this.code=code;this.details=details;} }
export interface PageSource {read(key:string,signal?:AbortSignal):Promise<Uint8Array>}
export function assertFormat(formatVersion:number){if(formatVersion!==FORMAT_VERSION)throw new EngineError('UNSUPPORTED_FORMAT',`Expected format ${FORMAT_VERSION}, received ${formatVersion}`,{formatVersion});}
