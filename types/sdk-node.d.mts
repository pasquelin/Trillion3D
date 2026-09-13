import type {AssetScope,JobSnapshot,PreparationProgress} from '../dist/sdk-core/index.js';
export const DEFAULT_SCOPE:'slice';
export const COMPILER_OUTPUT_LIMIT:number;
export function sha256(bytes:import('node:crypto').BinaryLike):string;
export interface ByteStore {read(key:string,signal?:AbortSignal):Promise<Uint8Array>;writeAtomic(key:string,bytes:Uint8Array):Promise<void>}
export function filesystemStore(root:string):ByteStore;
export function resolveCompileInput(input:string):Promise<{root:string;runtimeFile?:string}>;
export interface PrepareOptions {hierarchy?:'tree'|'dag';resourceBaseUrl:string;executable?:string;threads?:number;ramBudgetMb?:number;strategy?:'exact-source-order'|'greedy-adjacency';simplification?:'none'|'qem-endpoints';signal?:AbortSignal;onProgress?:(event:PreparationProgress&Record<string,unknown>)=>void}
export interface CompilationResult {schema:number;formatVersion?:number;compilerVersion:string;status:'ready';key:string;scope:AssetScope;selectedTriangles:number;selectedNodes:number[];primitives:unknown[];[key:string]:unknown}
export function prepareReference(input:string,output:string,scope?:AssetScope,budget?:number,options?:PrepareOptions):Promise<CompilationResult>;
export function prepare(input:string,output:string,scope?:AssetScope,budget?:number,options?:PrepareOptions):Promise<CompilationResult>;
export interface CompilationJob {promise:Promise<CompilationResult>;cancel(reason?:unknown):void;getSnapshot():JobSnapshot<CompilationResult>;subscribe(listener:()=>void):()=>void}
export interface CompilationJobOptions extends PrepareOptions {scope?:AssetScope;triangleBudget?:number;telemetry?:(snapshot:JobSnapshot<CompilationResult>)=>void}
export function createCompilationJob(id:string,input:string,output:string,options:CompilationJobOptions):Promise<CompilationJob>;
export function getSdkProvenance():Promise<{sdkVersion:string;scope:string;files:Record<string,{sha256:string}>}>;
