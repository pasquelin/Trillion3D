import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const labRoot=resolve(process.env.LAB_ROOT??'../render-tech-lab');
const directory=resolve(process.argv[2]??'');
assert.ok(process.argv[2],'Usage: node test/debugLogging.archive.mjs <campaign-directory>');
const {readJsonObjectEntries}=await import(pathToFileURL(join(labRoot,'shared/archive/jsonObjectStream.ts')));
const {createReportResultStream}=await import(pathToFileURL(join(labRoot,'shared/archive/reportPackage.ts')));
const manifest=JSON.parse(await readFile(join(directory,'objects/manifest.json'),'utf8'));
const markdown=await readFile(join(directory,'REPORT.md'),'utf8');
const digest=async file=>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');};
const rawPath=join(directory,'objects/result.json.gz');
const rawHash=await digest(rawPath);
assert.equal(rawHash,manifest.objects.find(o=>o.path==='objects/result.json.gz').sha256);
const lineStream=createInterface({input:createReadStream(join(directory,'logs/engine-events.jsonl')),crlfDelay:Infinity});
const lines=lineStream[Symbol.asyncIterator]();
const sessions=new Map(),phases={},media=new Map(manifest.media.map(m=>[m.sha256,m]));
let events=0,captures=0,samples=0,debug=false,status,checks=0,cpuSubmit=0;
try{
 for await(const entry of readJsonObjectEntries(createReportResultStream(rawPath))){
  const {key,index,value}=entry;
  if(key==='configuration')debug=value.debug===true;
  if(key==='status')status=value;
  if(key==='aaControl'){assert.equal(value.status,'passed');checks=value.checks.length;assert.ok(value.checks.every(c=>c.differentPixels===0));}
  if(index===undefined||index<0)continue;
  if(key==='engineEvents'){
   const line=await lines.next();assert.equal(line.done,false);assert.equal(line.value,JSON.stringify(value),`Event ${events} differs from raw`);events++;
   phases[value.phase]=(phases[value.phase]??0)+1;
   assert.notEqual(value.phase,'engine:diagnostic-loss');assert.notEqual(value.level,'error');
   const {diagnosticSession:session,diagnosticSequence:sequence}=value.context;
   if(session&&typeof sequence==='number'){assert.equal(sequence,(sessions.get(session)??0)+1);sessions.set(session,sequence);}
  }else if(key==='captures'){
   captures++;const match=/^data:([^;,]+);base64,(.*)$/s.exec(value.image);assert.ok(match);
   const bytes=Buffer.from(match[2],'base64'),hash=createHash('sha256').update(bytes).digest('hex'),asset=media.get(hash);assert.ok(asset,`Missing capture ${index}`);
   assert.equal(await digest(join(directory,asset.path)),hash);assert.equal((await stat(join(directory,asset.path))).size,bytes.length);
   assert.ok(markdown.includes(`](./${asset.path})`),`Capture ${index} absent from Markdown`);
  }else if(key==='samples'){
   samples++;assert.equal(value.measurementKind,'diagnostic');if(typeof value.cpuSubmitMs==='number')cpuSubmit++;
   if(value.backend==='webgpu-page-raster'){assert.equal(value.coverageReady,true);assert.equal(value.streamingError,null);}
  }
 }
 assert.equal((await lines.next()).done,true,'Extra events outside raw report');
}finally{lineStream.close();}
assert.equal(events,manifest.objects.find(o=>o.path==='logs/engine-events.jsonl').entries);
assert.ok(debug);assert.equal(status,'completed');assert.equal(samples,2400);assert.equal(captures,40);assert.equal(checks,40);assert.equal(cpuSubmit,600);
assert.equal((markdown.match(/!\[/g)??[]).length,captures);
for(const [,relative] of markdown.matchAll(/\]\(\.\/([^)]*)\)/g))assert.ok((await stat(join(directory,relative))).size>0,`Empty/missing link ${relative}`);
console.log(JSON.stringify({status:'passed',archive:directory,rawSha256:rawHash,events,captures,uniqueMedia:media.size,samples,aaChecks:checks,cpuSubmitSamples:cpuSubmit,sessions:sessions.size,gpuPassSamples:phases['engine:gpu-timing']??0},null,2));
