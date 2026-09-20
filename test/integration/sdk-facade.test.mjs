import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import ts from 'typescript';
import * as common from '../../packages/sdk/index.ts';
import * as core from '../../packages/sdk-core/index.ts';
import * as browser from '../../packages/sdk/browser.ts';
import * as browserLegacy from '../../packages/sdk-browser/index.ts';

test('the facade keeps canonical binding identity across environments', () => {
  assert.equal(common.LOD_QUALITY, core.LOD_QUALITY);
  assert.equal(browser.LOD_QUALITY, core.LOD_QUALITY);
  assert.equal(browser.createExplorer, browserLegacy.createExplorer);
});

test('facade imports reach no module with an initialization statement', () => {
  const roots = ['index.ts', 'browser.ts', 'node.mts'].map((file) =>
    resolve(import.meta.dirname, '../../packages/sdk', file),
  );
  const program = ts.createProgram(roots, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    types: ['node', '@webgpu/types'],
    skipLibCheck: true,
  });
  const effects = [];
  for (const source of program.getSourceFiles()) {
    if (!source.fileName.includes('/packages/') || source.fileName.includes('/node_modules/'))
      continue;
    for (const statement of source.statements)
      if (ts.isExpressionStatement(statement) || ts.isExportAssignment(statement))
        effects.push(`${source.fileName}:${statement.getStart(source)}`);
  }
  assert.deepEqual(effects, []);
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
  assert.equal(inventory.exports.length, 445);
  assert.deepEqual(inventory.collisions, []);
  assert.ok(
    inventory.exports.some(
      (entry) => entry.name === 'sideOf' && entry.disposition === 'newly exposed',
    ),
  );
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
  assert.equal(baseline.outputFiles[0].contents.length, 5_245);
  assert.equal(proposed.outputFiles[0].contents.length, 1_780);
  assert.equal(browserProposed.outputFiles[0].contents.length, 3_289);
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
