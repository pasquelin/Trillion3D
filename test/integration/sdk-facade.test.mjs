import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import * as common from '../../packages/sdk/index.ts';
import * as core from '../../packages/sdk-core/index.ts';
import * as browser from '../../packages/sdk/browser.ts';
import * as browserLegacy from '../../packages/sdk-browser/index.ts';

test('the facade keeps canonical binding identity across environments', () => {
  assert.equal(common.LOD_QUALITY, core.LOD_QUALITY);
  assert.equal(browser.LOD_QUALITY, core.LOD_QUALITY);
  assert.equal(browser.createExplorer, browserLegacy.createExplorer);
});

test('importing each facade starts no browser resource or native process', () => {
  for (const entry of ['index.ts', 'browser.ts', 'node.mts']) {
    const url = new URL(`../../packages/sdk/${entry}`, import.meta.url).href;
    const probe = `
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      const forbidden = (name) => () => { throw new Error('Import initialized ' + name); };
      for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'])
        childProcess[name] = forbidden(name);
      syncBuiltinESMExports();
      for (const name of ['Worker', 'SharedWorker', 'OffscreenCanvas', 'AudioContext'])
        globalThis[name] = function () { throw new Error('Import constructed ' + name); };
      globalThis.window = undefined;
      for (const name of ['document', 'navigator'])
        Object.defineProperty(globalThis, name, { configurable: true, get: forbidden(name) });
      globalThis.requestAnimationFrame = forbidden('requestAnimationFrame');
      globalThis.fetch = forbidden('fetch');
      await import(${JSON.stringify(url)});
    `;
    execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', probe],
      {
        timeout: 30_000,
        stdio: 'pipe',
      },
    );
  }
});

test('the five-import hierarchy example composes parents before children', () => {
  const {
    HIERARCHY_ROOT,
    MATRIX_VALUES,
    POSITION_VALUES,
    QUATERNION_VALUES,
    hierarchyUpdateBatch,
  } = common;
  const count = 3;
  const views = (buffer, stride) =>
    Array.from({ length: count }, (_, index) =>
      buffer.subarray(index * stride, (index + 1) * stride),
    );
  const world = new Float64Array(count * MATRIX_VALUES);
  const positions = new Float64Array(count * POSITION_VALUES);
  const rotations = new Float64Array(count * QUATERNION_VALUES);
  const scales = new Float64Array(count * POSITION_VALUES).fill(1);
  const parents = new Uint32Array([HIERARCHY_ROOT, 0, 1]);
  rotations[3] = rotations[7] = rotations[11] = 1;
  positions[0] = 2;
  positions[3] = 3;
  positions[6] = 5;
  hierarchyUpdateBatch(
    views(world, MATRIX_VALUES),
    views(positions, POSITION_VALUES),
    views(rotations, QUATERNION_VALUES),
    views(scales, POSITION_VALUES),
    parents,
    count,
    new Float64Array(MATRIX_VALUES),
  );
  assert.deepEqual([world[12], world[28], world[44]], [2, 5, 10]);
});

test('generated inventory and explicit facade files are current', async () => {
  const inventory = JSON.parse(
    await readFile(new URL('../../docs/api-inventory.json', import.meta.url)),
  );
  assert.equal(inventory.exports.length, 479);
  assert.deepEqual(inventory.collisions, []);
  assert.ok(inventory.exports.every((entry) => !entry.bindingIdentity.includes(process.cwd())));
  assert.ok(inventory.exports.every((entry) => !entry.bindingIdentity.includes('file://')));
  assert.ok(
    inventory.exports.some(
      (entry) => entry.name === 'sideOf' && entry.disposition === 'newly exposed',
    ),
  );
  const entries = new Map(inventory.exports.map((entry) => [entry.name, entry]));
  for (const [name, entryPoint] of [
    ['CameraPose', 'web-geometry (common)'],
    ['JobSnapshot', 'web-geometry (common)'],
    ['Explorer', 'web-geometry (browser condition)'],
    ['ExplorerOptions', 'web-geometry (browser condition)'],
    ['CompilationJob', 'web-geometry (node condition)'],
    ['CompilationResult', 'web-geometry (node condition)'],
    ['PrepareOptions', 'web-geometry (node condition)'],
  ]) {
    const entry = entries.get(name);
    assert.equal(entry?.kind, 'type', `${name} must remain a named public type`);
    assert.ok(
      entry.currentEntryPoints.includes(entryPoint),
      `${name} must remain reachable from ${entryPoint}`,
    );
  }
});

test('a maths-only bundle keeps baseline bytes and excludes platform modules', async () => {
  const bundle = (entry) =>
    build({
      stdin: {
        contents: `import { hierarchyUpdateBatch } from '${entry}'; console.log(hierarchyUpdateBatch);`,
        resolveDir: new URL('../..', import.meta.url).pathname,
      },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      metafile: true,
      treeShaking: true,
      minify: true,
    });
  const baseline = await bundle('./packages/sdk-core/index.ts');
  const proposed = await bundle('./packages/sdk/index.ts');
  const browserProposed = await bundle('./packages/sdk/browser.ts');
  const inputs = Object.keys(proposed.metafile.inputs);
  assert.ok(inputs.some((path) => path.endsWith('mathBatch.ts')));
  assert.ok(!inputs.some((path) => path.includes('/sdk-browser/') || path.includes('/sdk-node/')));
  assert.equal(baseline.outputFiles[0].contents.length, 5_263);
  assert.equal(proposed.outputFiles[0].contents.length, 1_780);
  assert.equal(browserProposed.outputFiles[0].contents.length, 3_292);
  assert.ok(
    !Object.keys(browserProposed.metafile.inputs).some((path) => path.includes('/sdk-node/')),
  );
  const browserOutput = Object.values(browserProposed.metafile.outputs)[0];
  assert.ok(
    !Object.entries(browserOutput.inputs).some(
      ([path, contribution]) => path.includes('/sdk-browser/') && contribution.bytesInOutput > 0,
    ),
  );
});
