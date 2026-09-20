#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const fixture = mkdtempSync(join(tmpdir(), 'web-geometry-installed-'));
const logs = [];

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  logs.push({ command: [command, ...args], cwd, stdout: result.stdout, stderr: result.stderr });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${result.stderr}`);
  return result.stdout;
}

function write(name, value) {
  writeFileSync(join(fixture, name), value);
}

function bundle(name, source) {
  write(`${name}.ts`, source);
  run(
    join(root, 'node_modules/.bin/esbuild'),
    [
      `${name}.ts`,
      '--bundle',
      '--format=esm',
      '--platform=browser',
      `--outfile=${name}.js`,
      `--metafile=${name}-meta.json`,
    ],
    fixture,
  );
  return JSON.parse(readFileSync(join(fixture, `${name}-meta.json`)));
}

let succeeded = false;
try {
  run(pnpm, ['run', 'build']);
  const packed = JSON.parse(run(pnpm, ['pack', '--json', '--pack-destination', fixture]));
  const archive = packed.filename ?? packed[0]?.filename;
  if (!archive) throw new Error('pnpm pack did not report an archive');
  const source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const dependencies = {
    [source.name]: `file:${archive}`,
    three: source.peerDependencies.three,
  };
  const devDependencies = Object.fromEntries(
    ['@types/node', '@webgpu/types', 'typescript'].map((name) => [
      name,
      source.devDependencies[name],
    ]),
  );
  write(
    'package.json',
    `${JSON.stringify(
      {
        name: 'web-geometry-installed-proof',
        private: true,
        type: 'module',
        packageManager: source.packageManager,
        dependencies,
        devDependencies,
      },
      null,
      2,
    )}\n`,
  );
  run(pnpm, ['install', '--frozen-lockfile=false'], fixture);
  const core = source.name === 'web-geometry' ? source.name : `${source.name}/core`;
  const node = source.name === 'web-geometry' ? source.name : `${source.name}/node`;
  const browser = source.name === 'web-geometry' ? source.name : `${source.name}/browser`;
  write(
    'runtime.mjs',
    `import { HIERARCHY_ROOT,MATRIX_VALUES,POSITION_VALUES,QUATERNION_VALUES,hierarchyUpdateBatch } from '${core}';\n` +
      `import { getSdkProvenance, prepare } from '${node}';\n` +
      `if(typeof hierarchyUpdateBatch!=='function'||typeof prepare!=='function')process.exit(2);\n` +
      `const n=2,views=(b,s)=>Array.from({length:n},(_,i)=>b.subarray(i*s,(i+1)*s));\n` +
      `const world=new Float64Array(n*MATRIX_VALUES),positions=new Float64Array(n*POSITION_VALUES),rotations=new Float64Array(n*QUATERNION_VALUES),scales=new Float64Array(n*POSITION_VALUES).fill(1),parents=new Uint32Array([HIERARCHY_ROOT,0]),local=new Float64Array(MATRIX_VALUES);\n` +
      `positions.set([2,3,4,5,7,11]);rotations[3]=rotations[7]=1;hierarchyUpdateBatch(views(world,MATRIX_VALUES),views(positions,POSITION_VALUES),views(rotations,QUATERNION_VALUES),views(scales,POSITION_VALUES),parents,n,local);if(world[28]!==7||world[29]!==10||world[30]!==15)process.exit(4);\n` +
      `const p=await getSdkProvenance();if(!p.files['dist/sdk-node/index.mjs'])process.exit(3);\n`,
  );
  run(process.execPath, ['runtime.mjs'], fixture);
  const bundles = {
    maths: bundle(
      'maths',
      `import { multiplyMatrix4Batch } from '${browser}';\nconsole.log(multiplyMatrix4Batch);\n`,
    ),
    hierarchy: bundle(
      'hierarchy',
      `import { hierarchyUpdateBatch } from '${browser}';\nconsole.log(hierarchyUpdateBatch);\n`,
    ),
    explorer: bundle(
      'explorer',
      `import { createExplorer } from '${browser}';\nconsole.log(createExplorer);\n`,
    ),
  };
  for (const name of ['maths', 'hierarchy']) {
    const inputs = bundles[name].outputs[`${name}.js`].inputs;
    if (
      Object.entries(inputs).some(
        ([path, contribution]) =>
          contribution.bytesInOutput > 0 && (path.includes('/three/') || path.includes('sdk-node')),
      )
    )
      throw new Error(`${name} bundle reaches renderer or Node modules`);
  }
  const manifest = JSON.parse(
    readFileSync(join(fixture, `node_modules/${source.name}/package.json`)),
  );
  const evidence = {
    package: `${manifest.name}@${manifest.version}`,
    commit: run('git', ['rev-parse', 'HEAD']).trim(),
    tools: { node: process.version, pnpm: run(pnpm, ['--version']).trim() },
    settings: { node: 'ESM', browser: 'esbuild bundle, ESM, browser platform' },
    files: packed.files?.map(({ path, size }) => ({ path, size })) ?? [],
    bundles,
  };
  const output = process.argv.indexOf('--output');
  if (output >= 0)
    writeFileSync(resolve(process.argv[output + 1]), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ package: evidence.package, commit: evidence.commit, tools: evidence.tools, fileCount: evidence.files.length, bundleBytes: Object.fromEntries(Object.entries(bundles).map(([name, meta]) => [name, meta.outputs[`${name}.js`]?.bytes])) })}\n`,
  );
  succeeded = true;
} catch (error) {
  writeFileSync(
    join(fixture, 'failure.json'),
    `${JSON.stringify({ error: String(error), logs }, null, 2)}\n`,
  );
  console.error(`Installed-package proof kept at ${fixture}`);
  throw error;
} finally {
  if (succeeded) rmSync(fixture, { recursive: true, force: true });
}
