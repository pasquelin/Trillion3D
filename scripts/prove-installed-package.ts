#!/usr/bin/env node
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Metafile } from 'esbuild';
import { evidenceSummary, installedEvidence } from './installed-package-evidence.ts';
import { browserEvidence, proveInstalledBrowserModes } from './installed-package-bundle.ts';
import { compileInstalledScene, type CompiledScene } from './installed-package-scene.ts';
import { proveInstalledRuntime } from './installed-package-runtime.ts';
import { proveInstalledTypes } from './installed-package-types.ts';
import {
  createInstalledFixture,
  type ExportsManifest,
  type PackageJson,
  type PackResult,
} from './installed-package-fixture.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const { fixture, logs, run, write, bundle, installedVersion } = createInstalledFixture(root);

try {
  run(pnpm, ['run', 'build']);
  const proveBrowser = process.argv.includes('--browser');
  const proveNative = process.argv.includes('--native') || proveBrowser;
  if (proveNative) run(pnpm, ['run', 'build:native']);
  const parsedPack = JSON.parse(run(pnpm, ['pack', '--json', '--pack-destination', fixture])) as
    PackResult | PackResult[];
  const packed: PackResult = Array.isArray(parsedPack) ? (parsedPack[0] ?? {}) : parsedPack;
  const archive = packed.filename;
  if (!archive) throw new Error('pnpm pack did not report an archive');
  const source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson;
  const dependencies: Record<string, string> = {
    [source.name]: `file:${archive}`,
    three: installedVersion('three'),
  };
  const devDependencies = Object.fromEntries(
    ['@types/node', '@types/three', '@webgpu/types', 'typescript'].map((name): [string, string] => [
      name,
      installedVersion(name),
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
  const packageName = source.name;
  write(
    'runtime.mjs',
    `import { HIERARCHY_ROOT,MATRIX_VALUES,POSITION_VALUES,QUATERNION_VALUES,getSdkProvenance,hierarchyUpdateBatch,prepare } from '${packageName}';\n` +
      `if(typeof hierarchyUpdateBatch!=='function'||typeof prepare!=='function')process.exit(2);\n` +
      `const n=2,views=(b,s)=>Array.from({length:n},(_,i)=>b.subarray(i*s,(i+1)*s));\n` +
      `const world=new Float64Array(n*MATRIX_VALUES),positions=new Float64Array(n*POSITION_VALUES),rotations=new Float64Array(n*QUATERNION_VALUES),scales=new Float64Array(n*POSITION_VALUES).fill(1),parents=new Uint32Array([HIERARCHY_ROOT,0]),local=new Float64Array(MATRIX_VALUES);\n` +
      `positions.set([2,3,4,5,7,11]);rotations[3]=rotations[7]=1;hierarchyUpdateBatch(views(world,MATRIX_VALUES),views(positions,POSITION_VALUES),views(rotations,QUATERNION_VALUES),views(scales,POSITION_VALUES),parents,n,local);if(world[28]!==7||world[29]!==10||world[30]!==15)process.exit(4);\n` +
      `const p=await getSdkProvenance();if(!p.files['dist/sdk-node/index.mjs'])process.exit(3);\n` +
      `for(const path of ['/core','/node','/browser','/dist/sdk-core/index.js'])try{await import('${packageName}'+path);process.exit(5)}catch(e){if(e.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')process.exit(6)}\n`,
  );
  run(process.execPath, ['runtime.mjs'], fixture);
  proveInstalledTypes({ fixture, packageName, run, write });
  let native: { primer: CompiledScene; replay: CompiledScene } | null = null;
  let compilerVersion: string | null = null;
  if (proveNative) {
    const executable = join(
      root,
      'packages/asset-compiler-rust/target/release',
      `web-geometry-compiler${process.platform === 'win32' ? '.exe' : ''}`,
    );
    const compile = (name: string, variant: number) =>
      compileInstalledScene({ fixture, executable, run, pnpm, name, variant });
    compilerVersion = run(executable, ['--version']).trim();
    native = {
      primer: compile('primer', 0),
      replay: compile('replay', 0.01),
    };
  }
  const bundles: Record<string, Metafile> = {
    default: bundle(
      'default',
      `import { hierarchyUpdateBatch } from '${packageName}';\nconsole.log(hierarchyUpdateBatch);\n`,
      'neutral',
      [],
    ),
    types: bundle(
      'types',
      `import type { CameraPose } from '${packageName}';\nconst pose:CameraPose={position:[0,0,1],target:[0,0,0],fov:45,near:.1,far:10};\nconsole.log(pose.position.length);\n`,
      'neutral',
      [],
    ),
  };
  for (const name of ['default']) {
    const inputs = bundles[name].outputs[`${name}.js`].inputs;
    if (
      Object.entries(inputs).some(
        ([path, contribution]) =>
          contribution.bytesInOutput > 0 &&
          (path.includes('/three/') ||
            path.includes('sdk-node') ||
            (name === 'default' && path.includes('sdk-browser'))),
      )
    )
      throw new Error(`${name} bundle reaches renderer or Node modules`);
  }
  if (
    Object.keys(bundles.types.outputs['types.js'].inputs).some((path) => path.includes(packageName))
  )
    throw new Error('type-only import was not erased');
  const manifest = JSON.parse(
    readFileSync(join(fixture, `node_modules/${source.name}/package.json`), 'utf8'),
  ) as ExportsManifest;
  const runtimeProof = proveInstalledRuntime({ fixture, packageName, run, write, bundle });
  bundles.maths = runtimeProof.bundles.maths;
  bundles.hierarchy = runtimeProof.bundles.hierarchy;
  bundles.worker = bundle('common-worker', runtimeProof.workerSource);
  const browserRun = proveBrowser
    ? await proveInstalledBrowserModes({
        fixture,
        packageName: source.name,
        browserEntry: manifest.exports['.'].browser?.import ?? 'dist/sdk-browser/index.js',
        bundler: join(root, 'node_modules/.bin/esbuild'),
        run,
      })
    : null;
  const browserBundle = browserRun?.bundled.bundle ?? null;
  const browserProof = browserRun?.bundled.proof ?? null;
  if (browserBundle) bundles.explorer = browserBundle.metafile;
  const evidence = {
    package: `${manifest.name}@${manifest.version}`,
    commit: run('git', ['rev-parse', 'HEAD']).trim(),
    ...installedEvidence({
      fixture,
      packageName,
      packed,
      tools: {
        node: process.version,
        pnpm: run(pnpm, ['--version']).trim(),
        typescript: installedVersion('typescript'),
        esbuild: installedVersion('esbuild'),
      },
      compilerVersion,
      browserProof,
      proveNative,
      proveBrowser,
    }),
    bundles,
    native,
    browser: browserEvidence(browserRun),
  };
  const output = process.argv.indexOf('--output');
  if (output >= 0)
    writeFileSync(resolve(process.argv[output + 1]), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${evidenceSummary(evidence)}\n`);
} catch (error) {
  console.error(JSON.stringify({ error: String(error), fixture, logs }, null, 2));
  throw error;
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
