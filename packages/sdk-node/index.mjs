import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DEFAULT_SCOPE} from '../sdk-core/index.ts';
export {DEFAULT_SCOPE};
export {createTerminalProgress,createBatchProgress} from './progress.mjs';
/** Longest accepted single line on either stream; the compiler emits small JSON lines only. */
export const COMPILER_LINE_LIMIT=4*1024*1024;
/** Grace period between a cooperative cancel request on stdin and a hard kill. */
export const CANCEL_GRACE_MS=5000;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function nativeCompilerPath(explicit){
 if(explicit)return explicit;
 if(process.env.WEB_GEOMETRY_COMPILER_BIN)return process.env.WEB_GEOMETRY_COMPILER_BIN;
 const ext=process.platform==='win32'?'.exe':'';
 return fileURLToPath(new URL(`../../packages/asset-compiler-rust/target/release/web-geometry-compiler${ext}`,import.meta.url));
}
/** Line-oriented JSON reader shared by both streams; a line that never ends is a protocol violation. */
function lineReader(onLine,onOverflow){
 let pending='';
 return chunk=>{pending+=chunk;if(pending.length>COMPILER_LINE_LIMIT){onOverflow();return;}const lines=pending.split('\n');pending=lines.pop()??'';for(const line of lines){if(line.trim())onLine(line);}};
}
/**
 * Runs the native compiler once. Node only launches it, forwards events and cancellation, and reads
 * the pointer it prints; the compiled manifest is read back from disk, never streamed through here.
 */
function runCompiler(args,options,onEvent){
 return new Promise((resolve,reject)=>{
  const child=spawn(nativeCompilerPath(options.executable),args,{stdio:['pipe','pipe','pipe']});
  let settled=false,killTimer=null,lastError=null,stdout='';
  const finish=(fn,value)=>{if(settled)return;settled=true;if(killTimer)clearTimeout(killTimer);options.signal?.removeEventListener('abort',onAbort);fn(value);};
  const fail=error=>{try{child.kill();}catch{/* Child may already have exited. */}finish(reject,error);};
  const onAbort=()=>{try{child.stdin.write('{"cancel":"*"}\n');}catch{/* stdin may be closed; the kill below still applies. */}killTimer=setTimeout(()=>{try{child.kill();}catch{/* Already gone. */}},CANCEL_GRACE_MS);};
  options.signal?.addEventListener('abort',onAbort,{once:true});
  if(options.signal?.aborted)onAbort();
  child.stdin.on('error',()=>{/* The compiler closed stdin; cancellation falls back to kill. */});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>COMPILER_LINE_LIMIT)fail(new Error('COMPILER_LINE_LIMIT'));});
  child.stderr.on('data',lineReader(line=>{let event;try{event=JSON.parse(line);}catch{lastError=line;return;}if(event.status==='error')lastError=event.code??line;try{onEvent?.(event);}catch(error){fail(error);}},()=>fail(new Error('COMPILER_LINE_LIMIT'))));
  child.on('error',fail);
  child.on('close',code=>{
   if(options.signal?.aborted){finish(reject,new Error('CANCELLED'));return;}
   let output=null;try{output=JSON.parse(stdout);}catch{/* Missing or partial pointer: reported below. */}
   if(code!==0){finish(reject,new Error(output?.code??lastError??`COMPILER_EXIT_${code}`));return;}
   if(!output){finish(reject,new Error('COMPILER_NO_POINTER'));return;}
   finish(resolve,output);
  });
 });
}
/** Native is the production path. The host selects a bundled executable or one on PATH. */
export async function prepare(input,output,scope=DEFAULT_SCOPE,budget=150000,options={}){
 if(typeof options.resourceBaseUrl!=='string'||!options.resourceBaseUrl)throw new Error('resourceBaseUrl is required');
 const args=[input,output,scope,String(budget),String(options.threads??2),String(options.ramBudgetMb??256),options.resourceBaseUrl,options.simplification??'none'];
 const pointer=await runCompiler(args,options,options.onProgress);
 if(pointer.status!=='ready')throw new Error(pointer.code??'COMPILER_NOT_READY');
 const manifest=JSON.parse(await readFile(join(output,'native',pointer.scope,pointer.url),'utf8'));
 return {...manifest,url:pointer.url,pointer:pointer.pointer,cache:pointer.cache};
}
/**
 * Prepares many models in one compiler process. `jobs` entries: {id, source, cache, scope, triangles,
 * resourceBaseUrl, simplification, threads, ramBudgetMb}. The compiler runs `workers` jobs at a time and
 * splits `ramBudgetMb` between them. Resolves with the batch summary (pointers only, nothing read from disk).
 */
export async function prepareMany(jobs,options={}){
 if(!Array.isArray(jobs)||jobs.length===0)throw new Error('jobs must be a non-empty array');
 for(const job of jobs){if(typeof job.resourceBaseUrl!=='string'||!job.resourceBaseUrl)throw new Error(`job ${job.id??'?'}: resourceBaseUrl is required`);}
 const directory=await mkdtemp(join(tmpdir(),'web-geometry-batch-'));
 try{
  const file=join(directory,'jobs.json');
  await writeFile(file,JSON.stringify({workers:options.workers??1,ramBudgetMb:options.ramBudgetMb,threads:options.threads,jobs}));
  const summary=await runCompiler(['--jobs',file],options,options.onEvent);
  if(summary.status==='error')throw new Error(summary.code??'INVALID_BATCH');
  return summary;
 }finally{await rm(directory,{recursive:true,force:true});}
}
/** Host-visible job lifecycle; abort forwards to the native subprocess. */
export async function createCompilationJob(id,input,output,options={}){
 const {createJob}=await import('../sdk-core/index.ts');
 return createJob(id,({signal,progress})=>prepare(input,output,options.scope??DEFAULT_SCOPE,options.triangleBudget??150000,{...options,signal,onProgress:progress}),{signal:options.signal,telemetry:options.telemetry});
}

/** Public provenance boundary: consumers never read SDK implementation paths themselves. Hashes only — full source is not loaded into the snapshot. */
export async function getSdkProvenance(){
 const {readdir}=await import('node:fs/promises');const root=new URL('../../',import.meta.url),files={};
 async function visit(relative){for(const entry of (await readdir(new URL(relative,root),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=relative+entry.name;if(entry.isDirectory())await visit(name+'/');else if(/\.(js|mjs)$/.test(entry.name)){const text=await readFile(new URL(name,root),'utf8');files[name]={sha256:sha256(text)};}}}
 await visit('dist/');
 for(const name of ['packages/asset-compiler-rust/src/lib.rs','packages/asset-compiler-rust/src/main.rs','packages/asset-compiler-rust/src/import.rs','packages/asset-compiler-rust/src/topology.rs','packages/asset-compiler-rust/src/qem.rs','packages/asset-compiler-rust/src/dag.rs','packages/asset-compiler-rust/src/geometry_page.rs','packages/asset-compiler-rust/src/manifest_binary.rs','packages/asset-compiler-rust/src/accessor_validation.rs','packages/asset-compiler-rust/src/perf.rs','packages/asset-compiler-rust/Cargo.lock']){const text=await readFile(new URL(name,root),'utf8');files[name]={sha256:sha256(text)};}
 const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
 return {sdkVersion:pkg.version,scope:'Installed SDK files at archive time; loaded binary equality not established',files};
}
