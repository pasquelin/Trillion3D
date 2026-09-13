export const COMPILER_VERSION:string;
export const FORMAT_VERSION:1;
export const CLUSTER_INDEX_COUNT:768;
export const CLUSTER_TRIANGLES:256;
export class CompilerError extends Error {readonly code:string;readonly details:Record<string,unknown>}
export interface Store {read(key:string,signal?:AbortSignal):Promise<Uint8Array>;writeAtomic(key:string,bytes:Uint8Array):Promise<void>}
export interface Leaf {id:number;min:number[];max:number[]}
export interface Tree {min:number[];max:number[];page?:number;children?:Tree[]}
export function hierarchy(leaves:Leaf[]):Tree|null;
export interface CompileOptions {source:Store;cache:Store;hash:(bytes:Uint8Array)=>string;compilerHash:string;resourceBaseUrl:string;scope?:'slice'|'full';budget?:number;runtimeFile?:string;signal?:AbortSignal;onProgress?:(event:{phase:string;completed:number;total:number;scope:'slice'|'full';key:string})=>void}
export function isGlb(bytes:Uint8Array):boolean;
export function parseGlb(bytes:Uint8Array):{json:Record<string,unknown>;bin:Uint8Array};
export function compileAsset(options:CompileOptions):Promise<{schema:1;compilerVersion:string;compilerHash?:string;status:'ready';key:string;scope:'slice'|'full';selectedTriangles:number;selectedNodes:number[];primitives:unknown[];[key:string]:unknown}>;
