import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DEFAULT_SCOPE} from '../sdk-core/index.ts';
export {DEFAULT_SCOPE};
export const COMPILER_OUTPUT_LIMIT=256*1024*1024;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function nativeCompilerPath(explicit){
 if(explicit)return explicit;
 const ext=process.platform==='win32'?'.exe':'';
 return fileURLToPath(new URL(`../../packages/asset-compiler-rust/target/release/web-geometry-compiler${ext}`,import.meta.url));
}
/** Native is the production path. The host selects a bundled executable or one on PATH. */
export async function prepare(input,output,scope=DEFAULT_SCOPE,budget=150000,options={}){
 if(typeof options.resourceBaseUrl!=='string'||!options.resourceBaseUrl)throw new Error('resourceBaseUrl is required');
 const args=[input,output,scope,String(budget),String(options.threads??2),String(options.ramBudgetMb??256),options.resourceBaseUrl,options.simplification??'none'];
 return new Promise((resolve,reject)=>{const child=spawn(nativeCompilerPath(options.executable),args,{signal:options.signal,stdio:['ignore','pipe','pipe']});const chunks=[];let outputBytes=0,pending='',error='',stderrBytes=0,settled=false;
  const fail=err=>{if(settled)return;settled=true;try{child.kill();}catch{/* Child may already have exited. */}reject(err);};
  const succeed=value=>{if(settled)return;settled=true;resolve(value);};
  child.stdout.on('data',chunk=>{outputBytes+=chunk.length;if(outputBytes>COMPILER_OUTPUT_LIMIT)fail(new Error('COMPILER_OUTPUT_LIMIT'));else chunks.push(chunk);});
  child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;pending+=chunk;if(stderrBytes>COMPILER_OUTPUT_LIMIT||pending.length>COMPILER_OUTPUT_LIMIT){fail(new Error('COMPILER_OUTPUT_LIMIT'));return;}const lines=pending.split('\n');pending=lines.pop()??'';for(const line of lines){try{const event=JSON.parse(line);options.onProgress?.(event);if(event.status==='error')error=event.code;}catch{error=line;}}});
  child.on('error',fail);child.on('close',code=>{if(code!==0){fail(new Error(error||`COMPILER_EXIT_${code}`));return;}try{succeed(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(e){fail(e);}});
 });
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
 for(const name of ['packages/asset-compiler-rust/src/lib.rs','packages/asset-compiler-rust/src/main.rs','packages/asset-compiler-rust/src/topology.rs','packages/asset-compiler-rust/src/qem.rs','packages/asset-compiler-rust/src/dag.rs','packages/asset-compiler-rust/src/geometry_page.rs','packages/asset-compiler-rust/src/manifest_binary.rs','packages/asset-compiler-rust/src/accessor_validation.rs','packages/asset-compiler-rust/src/perf.rs','packages/asset-compiler-rust/Cargo.lock']){const text=await readFile(new URL(name,root),'utf8');files[name]={sha256:sha256(text)};}
 const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
 return {sdkVersion:pkg.version,scope:'Installed SDK files at archive time; loaded binary equality not established',files};
}
