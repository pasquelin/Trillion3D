// #232 prerequisite, run by the measurer only. Output is raw evidence, never an optimization verdict.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { dansPageWebgpu } from '../../tests/browser/probes/pageWebgpu.ts';
import { machineLoad } from './summary.ts';
import type { run, WaterCostOptions } from '../../tests/browser/support/waterCostPage.ts';

type Reading = Awaited<ReturnType<typeof run>>;
declare global {
  var waterCost: { run(options: WaterCostOptions): Promise<Reading> };
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({
  options: {
    'engine-root': { type: 'string', default: root },
    out: { type: 'string', default: '.mesure/out/232-water-baseline' },
    runs: { type: 'string', default: '4' },
    frames: { type: 'string', default: '120' },
    warmup: { type: 'string', default: '30' },
  },
});
const positive = (value: string, name: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
};
const runs = positive(values.runs, 'runs'),
  frames = positive(values.frames, 'frames');
const warmup = positive(values.warmup, 'warmup');
if (runs < 3 || frames < 30) throw new Error('At least 3 runs and 30 frames required');
const engineRoot = resolve(values['engine-root']),
  out = resolve(root, values.out);
if (
  !relative(resolve(root, '.mesure/out'), out) ||
  relative(resolve(root, '.mesure/out'), out).startsWith('..')
)
  throw new Error('Output must be a child of .mesure/out');
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
// The fixture is fixed; only the backend entry changes when comparing two local issue worktrees.
const pageModule = resolve(root, 'tests/browser/support/waterCostPage.ts');
const backendModule = resolve(engineRoot, 'packages/sdk-browser/src/webgpu/pages/pages.ts');
const bundle = await build({
  stdin: {
    contents: `import { run as measure } from ${JSON.stringify(pageModule)};
import { webgpuPagesBackend } from ${JSON.stringify(backendModule)};
export const run = options => measure(webgpuPagesBackend, options);`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'waterCost',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'error',
});
const rows: {
  run: number;
  fraction: number;
  moving: boolean;
  enabled: boolean;
  reading: Reading;
}[] = [];
const errors: string[] = [];
const report = {
  protocol:
    'Total water contribution: resident tile visible versus parked, not fullscreen overhead alone',
  sampling:
    'Serialized frames; earliest-to-latest GPU envelope and submitted spans reported separately; same-clear-colour redraw',
  displayMode: 'headless',
  displayCapHz: null,
  commit: git(engineRoot, 'rev-parse', 'HEAD'),
  dirty: git(engineRoot, 'status', '--porcelain'),
  fixtureCommit: git(root, 'rev-parse', 'HEAD'),
  fixtureDirty: git(root, 'status', '--porcelain'),
  started: new Date().toISOString(),
  loadBefore: machineLoad(),
  runs,
  frames,
  warmup,
  rows,
  errors,
};
await mkdir(dirname(out), { recursive: true });
await mkdir(out, { recursive: false });
try {
  for (let repeat = 0; repeat < runs; repeat++)
    for (const fraction of [1 / 16, 1 / 4, 1])
      for (const moving of [false, true])
        for (const enabled of repeat % 2 ? [true, false] : [false, true]) {
          const options = { fraction, moving, enabled, frames, warmup };
          const pageErrors: string[] = [];
          const reading = await dansPageWebgpu(
            (o: WaterCostOptions) => globalThis.waterCost.run(o),
            options,
            {
              titre: 'Water cost #232',
              script: bundle.outputFiles[0].text,
              erreursPage: pageErrors,
            },
          );
          errors.push(...pageErrors);
          rows.push({ run: repeat + 1, fraction, moving, enabled, reading });
          if ('unavailable' in reading) errors.push(String(reading.unavailable));
          else {
            errors.push(...reading.errors);
            if (reading.waterPassMismatches)
              errors.push('Water pass presence differs from requested control');
            if (!reading.gpuEnvelopeMs) errors.push('No valid enclosing GPU frame samples');
            if (!reading.gpuFrameMs) errors.push('No valid GPU frame samples');
            if (reading.held) errors.push('Forced frames were held');
            if (reading.dpr !== 1) errors.push(`DPR must be 1, got ${reading.dpr}`);
            if (reading.size[0] !== 1280 || reading.size[1] !== 720)
              errors.push('Canvas size mismatch');
            if (reading.diagnostics.some((e) => /failed|lost/.test(e.phase)))
              errors.push('Engine failure diagnostic');
          }
          console.log(
            JSON.stringify({
              run: repeat + 1,
              ...options,
              gpuEnvelopeMs: 'gpuEnvelopeMs' in reading ? reading.gpuEnvelopeMs : null,
            }),
          );
        }
} finally {
  const range = (numbers: number[]) =>
    numbers.length === runs
      ? {
          min: Math.min(...numbers),
          max: Math.max(...numbers),
          spread: Math.max(...numbers) - Math.min(...numbers),
        }
      : null;
  const spread = [1 / 16, 1 / 4, 1].flatMap((fraction) =>
    [false, true].flatMap((moving) =>
      [false, true].map((enabled) => {
        const selected = rows.filter(
          (r) => r.fraction === fraction && r.moving === moving && r.enabled === enabled,
        );
        const envelopes = selected.flatMap(({ reading }) =>
          'gpuEnvelopeMs' in reading && reading.gpuEnvelopeMs ? [reading.gpuEnvelopeMs] : [],
        );
        const quantiles = selected.flatMap(({ reading }) =>
          'gpuFrameMs' in reading && reading.gpuFrameMs ? [reading.gpuFrameMs] : [],
        );
        return {
          fraction,
          moving,
          enabled,
          p50: range(envelopes.map((q) => q.p50)),
          p95: range(envelopes.map((q) => q.p95)),
          submittedP50: range(quantiles.map((q) => q.p50)),
          submittedP95: range(quantiles.map((q) => q.p95)),
        };
      }),
    ),
  );
  await writeFile(
    resolve(out, 'measurement.json'),
    JSON.stringify(
      { ...report, spread, loadAfter: machineLoad(), ended: new Date().toISOString() },
      null,
      2,
    ) + '\n',
  );
}
if (errors.length) throw new Error(`Water measurement incomplete: ${errors.join('; ')}`);
