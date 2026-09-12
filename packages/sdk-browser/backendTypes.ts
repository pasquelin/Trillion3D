import type * as THREE from 'three';
import type {AssetScope,PreparationProgress,CameraPose,FrameMetrics,BackendCapabilities,ClusterManifest} from '../sdk-core/index.ts';
import type {DiagnosticMode} from '../sdk-core/index.ts';
import type {ComparisonLayout} from './comparison.ts';

export type {AssetScope,PreparationProgress,CameraPose,FrameMetrics,BackendCapabilities,ClusterManifest,DiagnosticMode,ComparisonLayout};

export interface RenderBackend {
 id:string; capabilities:BackendCapabilities;
 setDiagnostic?(mode:DiagnosticMode):void;
 prepare():Promise<void>;
 render(camera:THREE.PerspectiveCamera):void;
 readonly overBudget:boolean;
 scene:THREE.Scene;
 metrics():Pick<FrameMetrics,'clusters'|'selectedTriangles'|'residentPages'|'geometryAllocationBytes'|'pageEvictions'|'frustumRejected'|'lodLevel'|'submittedTriangles'|'hizRejected'>;
 pendingUrls?():string[];
 pageUrls?():string[];
 acceptPage?(url:string,array:Uint32Array):void;
 syncResident?():void;
 flush?():Promise<void>;
 rasterRgba?():Uint8Array;
 visibilityIds?():Uint32Array;
 dispose():void;
}
export interface BackendContext {
 source:THREE.Object3D;
 metadata:ClusterManifest;
 indices:Map<string,Uint32Array>;
 associations:Map<THREE.Object3D,{meshes?:number;primitives?:number}>;
 signal?:AbortSignal;
 maxResidentPages?:number;
 maxCachedPages?:number;
 pixelError?:number;
 lodAdaptive?:boolean;
 viewport?:[number,number];
 gpuDevice?:GPUDevice;
}
export type BackendFactory = (context:BackendContext)=>RenderBackend;
export interface ExplorerOptions {
 replicaCount?:1|4|9;
 detail?:'source'|'maximum';
 onEvent?:(event:import('../sdk-core/index.ts').RuntimeEvent)=>void;
 manifestUrl:string;
 scope?:AssetScope;
 signal?:AbortSignal;
 width?:number;height?:number;fov?:number;pixelRatio?:number;
 pageFetchWorkers?:number;
 onPreparation?:(event:PreparationProgress)=>void;
 backends?:BackendFactory[];
 maxResidentPages?:number;
 maxCachedPages?:number;
 pixelError?:number;
 lodAdaptive?:boolean;
 preload?:'visible'|'all';
 comparisonLayout?:ComparisonLayout;
 comparisonPair?:[string,string];
 gpu?:GPU;
}
