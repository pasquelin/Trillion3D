import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prepare,
  prepareMany,
  createCompilationJob,
  DEFAULT_SCOPE,
  COMPILER_LINE_LIMIT,
  getSdkProvenance,
} from './index.mts';
/** A stand-in compiler that speaks the event protocol: events on stderr, a pointer on stdout, manifest on disk. */
async function fakeCompiler(root, body) {
  const executable = join(root, 'compiler');
  await writeFile(executable, `#!/usr/bin/env node\n${body}`);
  await chmod(executable, 0o755);
  return executable;
}
const readyCompiler = `
const [input,output,scope]=process.argv.slice(2);
const fs=require('node:fs'),path=require('node:path');
const dir=path.join(output,'native',scope,'k1');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'clusters.json'),JSON.stringify({status:'ready',key:'k1',scope,selectedTriangles:7,primitives:[]}));
process.stderr.write(JSON.stringify({event:'accepted',job:'job'})+'\\n');
process.stderr.write(JSON.stringify({event:'progress',job:'job',phase:'import',completed:1,total:1})+'\\n');
process.stderr.write(JSON.stringify({event:'complete',job:'job'})+'\\n');
process.stdout.write(JSON.stringify({status:'ready',key:'k1',scope,url:'k1/clusters.json',pointer:path.join(output,'native',scope,'manifest.json'),cache:output})+'\\n');
`;
test('Node SDK public API imports without executing a compiler or depending on UI', () => {
  assert.equal(typeof prepare, 'function');
  assert.equal(typeof prepareMany, 'function');
  assert.equal(typeof createCompilationJob, 'function');
  assert.equal(typeof getSdkProvenance, 'function');
});
test('Compilation jobs expose the shared slice default', () => {
  assert.equal(DEFAULT_SCOPE, 'slice');
});
test('getSdkProvenance hashes files without embedding source text', async () => {
  const provenance = await getSdkProvenance();
  assert.equal(provenance.sdkVersion, '0.2.0');
  const sample = Object.values(provenance.files)[0];
  assert.equal(typeof sample.sha256, 'string');
  assert.equal(sample.text, undefined);
  assert.ok(provenance.files['packages/asset-compiler-rust/src/import.rs']);
});
test('prepare relays events, reads the pointer from stdout and the manifest from disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-geometry-prepare-'));
  try {
    const executable = await fakeCompiler(root, readyCompiler);
    const events = [];
    const result = await prepare(join(root, 'in'), join(root, 'out'), 'slice', 1, {
      executable,
      resourceBaseUrl: '/assets/',
      onProgress: (event) => events.push(event.event),
    });
    assert.deepEqual(events, ['accepted', 'progress', 'complete']);
    assert.equal(result.status, 'ready');
    assert.equal(result.selectedTriangles, 7);
    assert.equal(result.url, 'k1/clusters.json');
    assert.equal(result.cache, join(root, 'out'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('compilation job progress always has a phase, including compiler lifecycle events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-geometry-job-progress-'));
  try {
    const executable = await fakeCompiler(root, readyCompiler);
    const phases = [];
    const job = await createCompilationJob('job', join(root, 'in'), join(root, 'out'), {
      executable,
      resourceBaseUrl: '/assets/',
      telemetry: (snapshot) => {
        if (snapshot.progress) phases.push(snapshot.progress.phase);
      },
    });
    await job.promise;
    assert.deepEqual(phases, ['accepted', 'import', 'complete', 'complete']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('prepare reports the compiler error code instead of a generic exit code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-geometry-error-'));
  try {
    const executable = await fakeCompiler(
      root,
      `process.stderr.write(JSON.stringify({event:'error',status:'error',job:'job',code:'EMPTY_SLICE',message:'x'})+'\\n');process.stdout.write(JSON.stringify({status:'error',code:'EMPTY_SLICE',message:'x'})+'\\n');process.exit(2);`,
    );
    await assert.rejects(
      prepare(join(root, 'in'), join(root, 'out'), 'slice', 1, {
        executable,
        resourceBaseUrl: '/assets/',
      }),
      (error) => String(error).includes('EMPTY_SLICE'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('prepare rejects a compiler line that never ends', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-geometry-line-'));
  try {
    const executable = await fakeCompiler(
      root,
      `process.stderr.write('x'.repeat(${COMPILER_LINE_LIMIT}+1));`,
    );
    await assert.rejects(
      prepare(join(root, 'in'), join(root, 'out'), 'slice', 1, {
        executable,
        resourceBaseUrl: '/assets/',
      }),
      (error) => String(error).includes('COMPILER_LINE_LIMIT'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('prepare writes a cancel line on stdin when the signal aborts, then kills after the grace period', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-geometry-cancel-'));
  try {
    const seen = join(root, 'stdin.txt');
    const executable = await fakeCompiler(
      root,
      `process.stdin.on('data',d=>{require('node:fs').writeFileSync(${JSON.stringify(seen)},String(d));process.stderr.write(JSON.stringify({event:'cancelled',status:'error',job:'job',code:'CANCELLED'})+'\\n');process.exit(2);});process.stderr.write(JSON.stringify({event:'accepted',job:'job'})+'\\n');setTimeout(()=>{},60000);`,
    );
    const controller = new AbortController();
    const promise = prepare(join(root, 'in'), join(root, 'out'), 'slice', 1, {
      executable,
      resourceBaseUrl: '/assets/',
      signal: controller.signal,
      onProgress: (event) => {
        if (event.event === 'accepted') controller.abort();
      },
    });
    await assert.rejects(promise, (error) => String(error).includes('CANCELLED'));
    assert.equal((await readFile(seen, 'utf8')).trim(), '{"cancel":"*"}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('prepareMany hands the compiler one batch file and returns its summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-geometry-batch-'));
  try {
    const executable = await fakeCompiler(
      root,
      `
const fs=require('node:fs');const [flag,file]=process.argv.slice(2);
const spec=JSON.parse(fs.readFileSync(file,'utf8'));
for(const job of spec.jobs)process.stderr.write(JSON.stringify({event:'queued',job:job.id})+'\\n');
process.stdout.write(JSON.stringify({status:'ready',completed:spec.jobs.length,failed:0,cancelled:0,workers:spec.workers,jobs:spec.jobs.map(j=>({job:j.id,status:'ready',pointer:{key:'k'}}))})+'\\n');`,
    );
    const events = [];
    const summary = await prepareMany(
      [
        { id: 'a', source: 's', cache: 'c', resourceBaseUrl: '/a/' },
        { id: 'b', source: 's', cache: 'c', resourceBaseUrl: '/b/' },
      ],
      { executable, workers: 2, onEvent: (event) => events.push(event.job) },
    );
    assert.deepEqual(events, ['a', 'b']);
    assert.equal(summary.status, 'ready');
    assert.equal(summary.workers, 2);
    assert.equal(summary.jobs.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('prepareMany refuses a job without resourceBaseUrl before spawning anything', async () => {
  await assert.rejects(prepareMany([{ id: 'a', source: 's', cache: 'c' }]), /resourceBaseUrl/);
});
