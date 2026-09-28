// Every stage of the DAG selection kernel compiled on a real WebGPU device (#922): the module
// `pipeline.ts` builds — `shader.ts` with the normal cone of `coneWgsl.ts` and the cut kernels it
// feeds (`wantedWgsl.ts`, `compactWgsl.ts`, `aheadWgsl.ts`, `error.ts`) —, in each variant the
// engine can compile (screen-error variant, `SPLIT` override), then one compute pipeline per
// entry point on the engine's own bind layout. Any compilation message of type `error` or any
// validation error fails. The node test gate only parses the text; this is where the GPU's own
// WGSL compiler reads it.
//
// The probe proves it can fail: the same run on a copy with a WGSL syntax error in the cone, and
// one with a type error, must each be refused.
//
// node --experimental-strip-types --test tests/browser/probes/dag-kernels-compile-gpu.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAG_SELECTION_SHADER } from '../../../packages/sdk-browser/src/gpu/dag/shader/shader.ts';
import { dagBindEntries } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts';
import { withScreenErrorVariant } from '../../../packages/sdk-browser/src/gpu/dag/shader/error.ts';
import { dansPageWebgpu } from './pageWebgpu.ts';

type Variant = { name: string; code: string; constants?: Record<string, number> };
type Verdict = { name: string; errors: string[] };

/** The compute entry points of `code`, as the text declares them. */
const entryPoints = (code: string) =>
  [...code.matchAll(/@compute[^{]*?\bfn (\w+)\(/g)].map((match) => match[1]);

/** The module and pipeline variants the engine compiles from `code`. */
function variants(code: string): Variant[] {
  return (['certifiee', 'reference'] as const).flatMap((screenError) => {
    const text = withScreenErrorVariant(code, screenError);
    return [
      { name: `${screenError}`, code: text },
      { name: `${screenError} SPLIT`, code: text, constants: { SPLIT: 1 } },
    ];
  });
}

/** Run in the page: each variant's module, then each entry point's pipeline, errors collected. */
async function compileAll({
  variants,
  entries,
  layoutEntries,
}: {
  variants: Variant[];
  entries: string[];
  layoutEntries: GPUBindGroupLayoutEntry[];
}) {
  const gpu = await globalThis.ouvrirAppareil();
  if (!gpu) return { unavailable: 'no WebGPU adapter' };
  const verdicts: Verdict[] = [];
  for (const { name, code, constants } of variants) {
    const { module, compilation } = await gpu.compile(code);
    const errors = compilation.map((message) => `module: ${message}`);
    const layout = gpu.device.createPipelineLayout({
      bindGroupLayouts: [gpu.device.createBindGroupLayout({ entries: layoutEntries })],
    });
    for (const entryPoint of entries) {
      gpu.device.pushErrorScope('validation');
      gpu.device.createComputePipeline({
        layout,
        compute: { module, entryPoint, ...(constants && { constants }) },
      });
      const error = await gpu.device.popErrorScope();
      if (error) errors.push(`${entryPoint}: ${error.message}`);
    }
    verdicts.push({ name, errors });
  }
  const { complet } = await gpu.fermer();
  return { adapter: complet, verdicts, uncaptured: gpu.erreurs };
}

/** Every variant and stage of `code` compiled on the GPU: the adapter, and each variant's errors. */
async function compileOnGpu(code: string) {
  const entries = entryPoints(code);
  const result = await dansPageWebgpu(compileAll, {
    variants: variants(code),
    entries,
    layoutEntries: dagBindEntries(),
  });
  assert.equal(result.unavailable, undefined, 'WebGPU must be available');
  return { ...result, entries };
}

/** `code` with `from` replaced by `to`: the edit must land. */
function edited(from: string, to: string) {
  assert.ok(DAG_SELECTION_SHADER.includes(from), `${from} is no longer in the kernel`);
  return DAG_SELECTION_SHADER.replace(from, to);
}

test('every DAG selection stage compiles and validates on the GPU, in every variant', async () => {
  const { adapter, verdicts, uncaptured, entries } = await compileOnGpu(DAG_SELECTION_SHADER);
  for (const stage of ['dagPrepare', 'dagWanted', 'dagMask', 'dagDrawPrefix', 'dagDrawScatter'])
    assert.ok(entries.includes(stage), `${stage} is an entry point`);
  assert.deepEqual(
    verdicts,
    variants(DAG_SELECTION_SHADER).map(({ name }) => ({ name, errors: [] })),
  );
  assert.deepEqual(uncaptured, []);
  console.log(JSON.stringify({ adapter, stages: entries.length, variants: verdicts.length }));
});

test('a WGSL syntax error or type error in the cone is refused', async () => {
  const cone = 'let d=dot(axisWorld,view);';
  for (const [kind, code] of [
    ['syntax', edited(cone, 'let d=dot(axisWorld,view)')],
    ['type', edited(cone, 'let d:u32=dot(axisWorld,view);')],
  ]) {
    const { verdicts } = await compileOnGpu(code);
    for (const { name, errors } of verdicts)
      assert.ok(
        errors.some((error) => error.startsWith('module:')),
        `${kind} error, ${name}: not refused`,
      );
  }
});
