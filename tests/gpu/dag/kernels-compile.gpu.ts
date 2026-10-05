// Every stage of the DAG selection kernel compiles and validates on the machine's device (#922):
// the text the engine compiles (`shader.ts`, the normal cone and the cut kernels it feeds) under
// each screen-error variant (`withScreenErrorVariant`, as `pipeline.ts` renders it), then the
// engine's own stages (`createDagStages`) with and without the `SPLIT` override. The Node gate only
// parses the text; here the GPU's own WGSL compiler reads it. The proof can fail: a copy with a
// WGSL syntax error in the cone, and one with a type error, must each be refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { DAG_SELECTION_SHADER } from '../../../packages/sdk-browser/src/gpu/dag/shader/shader.ts';
import { withScreenErrorVariant } from '../../../packages/sdk-browser/src/gpu/dag/shader/error.ts';
import { SCREEN_ERROR_VARIANTS } from '../../../packages/sdk-core/src/lod/screenErrorVariants.ts';
import { loadPage, runOnDawn } from '../kit/onDawn.ts';
import type { KernelText } from './kernelsCompilePage.ts';

const CONE = 'let d=dot(axisWorld,view);';

/** The kernel with `from` replaced by `to`: the edit must land. */
function edited(from: string, to: string) {
  assert.ok(DAG_SELECTION_SHADER.includes(from), `${from} is no longer in the kernel`);
  return DAG_SELECTION_SHADER.replace(from, to);
}

const SOURCES = {
  shipped: DAG_SELECTION_SHADER,
  'syntax error': edited(CONE, 'let d=dot(axisWorld,view)'),
  'type error': edited(CONE, 'let d:u32=dot(axisWorld,view);'),
};
const texts: KernelText[] = Object.entries(SOURCES).flatMap(([source, code]) =>
  SCREEN_ERROR_VARIANTS.map((variant) => ({
    name: `${source} ${variant}`,
    code: withScreenErrorVariant(code, variant),
  })),
);

// One device for every text: both tests read the same run.
const run = (async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'kernelsCompilePage.ts'),
    'dagKernels',
  )) as typeof import('./kernelsCompilePage.ts');
  return runOnDawn(page.compileKernels, texts);
})();
const verdictsOf = async (source: string) =>
  (await run).verdicts.filter(({ name }) => name.startsWith(`${source} `));

test('every DAG selection stage compiles and validates on the GPU, in every variant', async () => {
  const verdicts = await verdictsOf('shipped');
  assert.equal(verdicts.length, SCREEN_ERROR_VARIANTS.length * 2);
  assert.deepEqual(
    verdicts.filter(({ errors }) => errors.length),
    [],
  );
  const { adapter, uncaptured } = await run;
  assert.deepEqual(uncaptured, []);
  console.log(JSON.stringify({ adapter, verdicts: verdicts.length }));
});

test('a WGSL syntax error or type error in the cone is refused', async () => {
  for (const source of ['syntax error', 'type error'])
    for (const { name, split, errors } of await verdictsOf(source))
      assert.ok(
        errors.some((error) => error.startsWith('module:')),
        `${name}${split ? ' SPLIT' : ''}: not refused`,
      );
});
