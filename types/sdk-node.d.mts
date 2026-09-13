import type {AssetScope,JobSnapshot,PreparationProgress} from '../dist/sdk-core/index.js';
export const DEFAULT_SCOPE:'slice';
export const COMPILER_OUTPUT_LIMIT:number;
export interface PrepareOptions {resourceBaseUrl:string;executable?:string;threads?:number;ramBudgetMb?:number;simplification?:'none'|'qem-endpoints';signal?:AbortSignal;onProgress?:(event:PreparationProgress&Record<string,unknown>)=>void}
export interface CompilationResult {schema:number;formatVersion?:number;compilerVersion:string;status:'ready';key:string;scope:AssetScope;selectedTriangles:number;selectedNodes:number[];primitives:unknown[];[key:string]:unknown}
export function prepare(input:string,output:string,scope?:AssetScope,budget?:number,options?:PrepareOptions):Promise<CompilationResult>;
export interface CompilationJob {promise:Promise<CompilationResult>;cancel(reason?:unknown):void;getSnapshot():JobSnapshot<CompilationResult>;subscribe(listener:()=>void):()=>void}
export interface CompilationJobOptions extends PrepareOptions {scope?:AssetScope;triangleBudget?:number;telemetry?:(snapshot:JobSnapshot<CompilationResult>)=>void}
export function createCompilationJob(id:string,input:string,output:string,options:CompilationJobOptions):Promise<CompilationJob>;
export function getSdkProvenance():Promise<{sdkVersion:string;scope:string;files:Record<string,{sha256:string}>}>;
