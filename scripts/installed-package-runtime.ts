import type { Metafile } from 'esbuild';
import type { Bundle, Run, Write } from './installed-package-contracts.ts';

const json = (value: string): string => JSON.stringify(value);

function installedWorkerRuntimeSource(packageName: string): string {
  return `import {MATRIX_VALUES,multiplyMatrix4Batch} from ${json(packageName)};
const a=new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,2,3,4,1]);
const b=new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,5,7,11,1]);
const out=new Float64Array(MATRIX_VALUES);
multiplyMatrix4Batch([out],[a],[b],1);
const translation=Array.from(out.subarray(12,15));
if(translation.join(',')!=='7,10,15')throw new Error('installed worker common maths produced '+translation);
postMessage({translation,commonSubset:true});`;
}

function importOnlySource(packageName: string): string {
  return `import {syncBuiltinESMExports} from 'node:module';
const fail=(operation)=>(()=>{throw new Error('import-only package performed '+operation)});
globalThis.fetch=fail('fetch');globalThis.Worker=class{constructor(){fail('worker')()}};
globalThis.OffscreenCanvas=class{constructor(){fail('render')()}};
globalThis.requestAnimationFrame=fail('render');
globalThis.document=new Proxy({},{get:fail('document access')});
const child=process.getBuiltinModule('node:child_process');
for(const name of ['exec','execFile','execFileSync','execSync','fork','spawn','spawnSync'])child[name]=fail('subprocess');
const fs=process.getBuiltinModule('node:fs');
for(const name of ['access','createReadStream','open','readFile','readdir','stat'])fs[name]=fail('host file read');
const fsp=process.getBuiltinModule('node:fs/promises');
for(const name of ['access','open','readFile','readdir','stat'])fsp[name]=fail('host file read');
syncBuiltinESMExports();
const sdk=await import(${json(packageName)});
if(typeof sdk.hierarchyUpdateBatch!=='function'||typeof sdk.multiplyMatrix4Batch!=='function')throw new Error('common maths exports missing');`;
}

const emittedInputs = (meta: Metafile, output: string) =>
  Object.entries(meta.outputs[`${output}.js`]?.inputs ?? {}).filter(
    ([, contribution]) => contribution.bytesInOutput > 0,
  );

function assertInstalledMathReachability(bundles: {
  maths: Metafile;
  hierarchy: Metafile;
}): void {
  for (const name of ['maths', 'hierarchy'] as const) {
    const forbidden = emittedInputs(bundles[name], name)
      .map(([path]) => path)
      .filter(
        (path) =>
          path.includes('/sdk-browser/') || path.includes('/sdk-node/') || path.includes('/three/'),
      );
    if (forbidden.length)
      throw new Error(`${name} bundle reaches platform code: ${forbidden.join(', ')}`);
  }
}

export function proveInstalledRuntime({
  packageName,
  fixture,
  run,
  write,
  bundle,
}: {
  packageName: string;
  fixture: string;
  run: Run;
  write: Write;
  bundle: Bundle;
}): { importOnly: true; bundles: { maths: Metafile; hierarchy: Metafile }; workerSource: string } {
  write('runtime-import-only.mjs', importOnlySource(packageName));
  run(process.execPath, ['runtime-import-only.mjs'], fixture);
  const bundles = {
    maths: bundle(
      'maths',
      `import { multiplyMatrix4Batch } from ${json(packageName)};\nconsole.log(multiplyMatrix4Batch);\n`,
    ),
    hierarchy: bundle(
      'hierarchy',
      `import { hierarchyUpdateBatch } from ${json(packageName)};\nconsole.log(hierarchyUpdateBatch);\n`,
    ),
  };
  assertInstalledMathReachability(bundles);
  return {
    importOnly: true,
    bundles,
    workerSource: installedWorkerRuntimeSource(packageName),
  };
}
