import type {AssetScope,JobSnapshot,PreparationProgress} from '../dist/sdk-core/index.js';
export const DEFAULT_SCOPE:'slice';
export const COMPILER_LINE_LIMIT:number;
export const CANCEL_GRACE_MS:number;
/** One JSON line from the compiler's stderr: `event` is queued | accepted | progress | complete | cancelled | error | batch | done. */
export interface CompilerEvent {event:string;job:string;ratio?:number;phase?:string;[key:string]:unknown}
/** Live terminal line for one job (spinner, bar from `ratio`, phase, elapsed); plain lines when the stream is not a TTY. */
export interface TerminalProgress {event(event:CompilerEvent):void;note(text:string):void;fail(message:string):void}
export function createTerminalProgress(options?:{label?:string;index?:number;total?:number;stream?:NodeJS.WriteStream;width?:number;interval?:number}):TerminalProgress;
/** One terminal line per job of a batch, fed by `prepareMany({onEvent})`. */
export function createBatchProgress(options?:{stream?:NodeJS.WriteStream}):{event(event:CompilerEvent):void};
export interface PrepareOptions {resourceBaseUrl:string;executable?:string;threads?:number;ramBudgetMb?:number;simplification?:'none'|'qem-endpoints';signal?:AbortSignal;onProgress?:(event:CompilerEvent&Partial<PreparationProgress>)=>void}
/** Fields common to the compiler's stdout pointer and the manifest read back from disk. */
export interface CompilationSummary {status:'ready';key:string;scope:AssetScope;url:string;pointer:string;cache:string;compilerVersion:string;selectedTriangles:number;sourceTriangles?:number|null;totalNodes?:number|null;simplification?:boolean;unsupported?:unknown}
/** What the compiler prints on stdout for one job; the compiled manifest itself stays on disk at `pointer`. */
export interface CompilationPointer extends CompilationSummary {formatVersion:number;selectedNodes:number;primitives:number;metrics:{importMs:number;clusterHierarchyPagesMs:number;wallMs:number;outputGeometryBytes:number;threads:number;ramBudgetMb:number}}
/** `prepare()` result: the manifest (`clusters.json`) read from disk plus the pointer's location fields. */
export interface CompilationResult extends CompilationSummary {schema:number;formatVersion?:number;selectedNodes:number[];primitives:unknown[];[key:string]:unknown}
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
