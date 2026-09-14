import type {AssetScope,JobSnapshot,PreparationProgress} from '../dist/sdk-core/index.js';
export const DEFAULT_SCOPE:'slice';
export const COMPILER_LINE_LIMIT:number;
export const CANCEL_GRACE_MS:number;
/** One JSON line from the compiler's stderr: `event` is queued | accepted | progress | complete | cancelled | error | batch | done. */
export interface CompilerEvent {event:string;job:string;[key:string]:unknown}
export interface PrepareOptions {resourceBaseUrl:string;executable?:string;threads?:number;ramBudgetMb?:number;simplification?:'none'|'qem-endpoints';signal?:AbortSignal;onProgress?:(event:CompilerEvent&Partial<PreparationProgress>)=>void}
/** What the compiler prints on stdout for one job; the compiled manifest itself stays on disk at `pointer`. */
export interface CompilationPointer {status:'ready';key:string;scope:AssetScope;url:string;pointer:string;cache:string;formatVersion:number;compilerVersion:string;selectedTriangles:number;sourceTriangles:number|null;selectedNodes:number;totalNodes:number|null;primitives:number;simplification:boolean;metrics:{importMs:number;clusterHierarchyPagesMs:number;wallMs:number;outputGeometryBytes:number;threads:number;ramBudgetMb:number};unsupported:unknown}
export interface CompilationResult {schema:number;formatVersion?:number;compilerVersion:string;status:'ready';key:string;scope:AssetScope;url:string;pointer:string;cache:string;selectedTriangles:number;selectedNodes:number[];primitives:unknown[];[key:string]:unknown}
export function prepare(input:string,output:string,scope?:AssetScope,budget?:number,options?:PrepareOptions):Promise<CompilationResult>;
export interface BatchJob {id?:string;source:string;cache:string;resourceBaseUrl:string;scope?:AssetScope;triangles?:number;threads?:number;ramBudgetMb?:number;simplification?:'none'|'qem-endpoints'}
export interface BatchOptions {workers?:number;ramBudgetMb?:number;threads?:number;executable?:string;signal?:AbortSignal;onEvent?:(event:CompilerEvent)=>void}
export interface BatchOutcome {job:string;status:'ready'|'error';pointer?:CompilationPointer;code?:string;message?:string}
export interface BatchSummary {status:'ready'|'partial'|'failed';completed:number;failed:number;cancelled:number;jobs:BatchOutcome[]}
export function prepareMany(jobs:BatchJob[],options?:BatchOptions):Promise<BatchSummary>;
export interface CompilationJob {promise:Promise<CompilationResult>;cancel(reason?:unknown):void;getSnapshot():JobSnapshot<CompilationResult>;subscribe(listener:()=>void):()=>void}
export interface CompilationJobOptions extends PrepareOptions {scope?:AssetScope;triangleBudget?:number;telemetry?:(snapshot:JobSnapshot<CompilationResult>)=>void}
export function createCompilationJob(id:string,input:string,output:string,options:CompilationJobOptions):Promise<CompilationJob>;
export function getSdkProvenance():Promise<{sdkVersion:string;scope:string;files:Record<string,{sha256:string}>}>;
