import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,copyFile,cp,chmod,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {prepare,createCompilationJob,filesystemStore,DEFAULT_SCOPE,COMPILER_OUTPUT_LIMIT,getSdkProvenance,getReferenceCompilerHash} from './index.mjs';
test('Node SDK public API imports without executing a compiler or depending on UI',()=>{assert.equal(typeof prepare,'function');assert.equal(typeof createCompilationJob,'function');assert.equal(typeof filesystemStore,'function');assert.equal(typeof getSdkProvenance,'function');});
test('Compilation jobs expose the shared slice default',()=>{assert.equal(DEFAULT_SCOPE,'slice');});
test('reference compiler fingerprint changes with QEM implementation and dependency lock',async()=>{
 const root=await mkdtemp(join(tmpdir(),'web-geometry-fingerprint-'));
 try{
  const source=new URL('../../',import.meta.url),core=join(root,'packages/asset-compiler-core'),node=join(root,'packages/sdk-node');
  await mkdir(core,{recursive:true});await mkdir(node,{recursive:true});await mkdir(join(root,'packages/sdk-core'),{recursive:true});
  const names=(await readdir(new URL('packages/asset-compiler-core/',source))).filter(name=>name.endsWith('.mjs'));
  for(const name of names)await copyFile(new URL(`packages/asset-compiler-core/${name}`,source),join(core,name));
  for(const name of ['packages/asset-compiler-core/package.json','packages/sdk-node/index.mjs','packages/sdk-node/package.json','packages/sdk-core/contracts.ts','package.json','package-lock.json']){
   await copyFile(new URL(name,source),join(root,name));
  }
  const base=await getReferenceCompilerHash(pathToFileURL(`${root}/`));
  const qem=join(core,'qem.mjs');await writeFile(qem,Buffer.concat([await readFile(qem),Buffer.from('\n// changed algorithm\n')]));
  const changedQem=await getReferenceCompilerHash(pathToFileURL(`${root}/`));assert.notEqual(changedQem,base);
  const lock=join(root,'package-lock.json');await writeFile(lock,Buffer.concat([await readFile(lock),Buffer.from('\n')]));
  assert.notEqual(await getReferenceCompilerHash(pathToFileURL(`${root}/`)),changedQem);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('packaged reference compiler fingerprints its shipped runtime without source or lockfile',async()=>{
 const root=await mkdtemp(join(tmpdir(),'web-geometry-package-'));
 try{
  await cp(new URL('../../dist/',import.meta.url),join(root,'dist'),{recursive:true});
  await copyFile(new URL('../../package.json',import.meta.url),join(root,'package.json'));
  await cp(new URL('../../node_modules/meshoptimizer/',import.meta.url),join(root,'node_modules/meshoptimizer'),{recursive:true});
  const {getReferenceCompilerHash:shippedHash}=await import(pathToFileURL(join(root,'dist/sdk-node/index.mjs')).href);
  assert.match(await shippedHash(),/^[a-f0-9]{64}$/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('getSdkProvenance hashes files without embedding source text',async()=>{
 const provenance=await getSdkProvenance();
 assert.equal(provenance.sdkVersion,'0.1.0');
 const sample=Object.values(provenance.files)[0];
 assert.equal(typeof sample.sha256,'string');
 assert.equal(sample.text,undefined);
});
test('prepare kills a compiler whose stderr exceeds the output bound',async()=>{
 const root=await mkdtemp(join(tmpdir(),'web-geometry-stderr-'));try{
  const executable=join(root,'compiler');
  await writeFile(executable,`#!/usr/bin/env node\nprocess.stderr.write('x'.repeat(${COMPILER_OUTPUT_LIMIT}+1));\n`);
  await chmod(executable,0o755);
  await assert.rejects(prepare(join(root,'in'),join(root,'out'),'slice',1,{executable,resourceBaseUrl:'/assets/'}),error=>String(error).includes('COMPILER_OUTPUT_LIMIT'));
 }finally{await rm(root,{recursive:true,force:true});}
});
