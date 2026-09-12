import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {prepare,createCompilationJob,filesystemStore,DEFAULT_SCOPE,COMPILER_OUTPUT_LIMIT,getSdkProvenance} from './index.mjs';
test('Node SDK public API imports without executing a compiler or depending on UI',()=>{assert.equal(typeof prepare,'function');assert.equal(typeof createCompilationJob,'function');assert.equal(typeof filesystemStore,'function');assert.equal(typeof getSdkProvenance,'function');});
test('Compilation jobs expose the shared slice default',()=>{assert.equal(DEFAULT_SCOPE,'slice');});
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
