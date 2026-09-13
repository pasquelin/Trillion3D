import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile,writeFile,mkdir,rename,rm,stat,readdir} from 'node:fs/promises';
import {resolve,dirname,sep,basename,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {compileAsset} from '../asset-compiler-core/index.mjs';
import {DEFAULT_SCOPE} from '../sdk-core/index.ts';
export {DEFAULT_SCOPE};
export const COMPILER_OUTPUT_LIMIT=64*1024*1024;
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function filesystemStore(root){
 const base=resolve(root);const path=key=>{const result=resolve(base,key);if(!result.startsWith(base+sep))throw new Error('Cache/source key escapes root');return result;};
 const created=new Set();
 return {read:async (key,signal)=>new Uint8Array(await readFile(path(key),{signal})),async writeAtomic(key,bytes){const target=path(key),dir=dirname(target),temp=target+'.'+randomUUID()+'.tmp';if(!created.has(dir)){await mkdir(dir,{recursive:true});created.add(dir);}try{await writeFile(temp,bytes);await rename(temp,target);}finally{await rm(temp,{force:true});}}};
}
function isSafeSourceName(name){
 return typeof name==='string'&&name.length>0&&name.length<256&&name!=='.'&&name!=='..'&&!/[\\/]/.test(name)&&!name.includes('..')&&!name.includes('\0');
}
/** Directory with `manifest.json`, directory with exactly one `.gltf`/`.glb`, or a `.gltf`/`.glb` file. */
export async function resolveCompileInput(input){
 const resolved=resolve(input);
 const info=await stat(resolved);
 if(info.isFile()){
  const file=basename(resolved);
  if(!isSafeSourceName(file)||!/\.(gltf|glb)$/i.test(file))throw new Error('Source file must be a .gltf or .glb');
  return {root:dirname(resolved),runtimeFile:file};
 }
 if(existsSync(join(resolved,'manifest.json')))return {root:resolved};
 const models=(await readdir(resolved)).filter(name=>isSafeSourceName(name)&&/\.(gltf|glb)$/i.test(name));
 if(models.length!==1)throw new Error('Source directory needs manifest.json or exactly one .gltf/.glb');
 return {root:resolved,runtimeFile:models[0]};
}
export async function prepareReference(input,output,scope=DEFAULT_SCOPE,budget=150000,options={}){
 if(typeof options.resourceBaseUrl!=='string'||!options.resourceBaseUrl)throw new Error('resourceBaseUrl is required');
 const compilerHash=await getReferenceCompilerHash();
 const source=await resolveCompileInput(input);
 return compileAsset({source:filesystemStore(source.root),cache:filesystemStore(output),hash:sha256,compilerHash,resourceBaseUrl:options.resourceBaseUrl,scope,budget,strategy:options.strategy??'exact-source-order',simplification:options.simplification??'none',runtimeFile:source.runtimeFile,signal:options.signal,onProgress:options.onProgress});
}

/** Fingerprint every local compiler module and pinned dependency used by the reference path. */
export async function getReferenceCompilerHash(root=new URL('../../',import.meta.url)){
 const prefix=import.meta.url.includes('/dist/sdk-node/')?'dist':'packages';
 const directory=new URL(`${prefix}/asset-compiler-core/`,root);
 const modules=(await readdir(directory)).filter(name=>name.endsWith('.mjs')&&!name.endsWith('.test.mjs')).sort();
 const names=[...modules.map(name=>`${prefix}/asset-compiler-core/${name}`),`${prefix}/sdk-node/index.mjs`,`${prefix}/sdk-core/contracts.${prefix==='dist'?'js':'ts'}`,'package.json'];
 if(prefix==='packages')names.push('packages/asset-compiler-core/package.json','packages/sdk-node/package.json');
 if(existsSync(fileURLToPath(new URL('package-lock.json',root))))names.push('package-lock.json');
 const digest=createHash('sha256');
 for(const name of names){
  const bytes=await readFile(new URL(name,root));
  digest.update(name);digest.update('\0');digest.update(sha256(bytes));digest.update('\0');
 }
 return digest.digest('hex');
}

function nativeCompilerPath(explicit){
 if(explicit)return explicit;
 const ext=process.platform==='win32'?'.exe':'';
 const dir=new URL('../../packages/asset-compiler-rust/target/release/',import.meta.url);
 const primary=fileURLToPath(new URL(`web-geometry-compiler${ext}`,dir));
 if(existsSync(primary))return primary;
 return fileURLToPath(new URL(`rtl-asset-compiler${ext}`,dir));
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
 for(const name of ['packages/asset-compiler-rust/src/lib.rs','packages/asset-compiler-rust/src/main.rs','packages/asset-compiler-rust/src/topology.rs','packages/asset-compiler-rust/src/cluster.rs','packages/asset-compiler-rust/src/qem.rs','packages/asset-compiler-rust/src/lod.rs','packages/asset-compiler-rust/Cargo.lock']){const text=await readFile(new URL(name,root),'utf8');files[name]={sha256:sha256(text)};}
 const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
 return {sdkVersion:pkg.version,scope:'Installed SDK files at archive time; loaded binary equality not established',files};
}
