// #232 prerequisite, run by the recette only. Output is raw evidence, never an optimization verdict.
import { waterCostRun } from './waterCostRun.ts';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runOnDawn } from '../../tests/gpu/kit/onDawn.ts';
import { takeBenchLock } from '../dawn/lock.ts';
import { machineLoad } from './summary.ts';
import type { run, WaterCostOptions } from '../../tests/gpu/water/waterCostPage.ts';

type Reading = Awaited<ReturnType<typeof run>>;

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({
  options: {
    'engine-root': { type: 'string', default: root },
    'compare-engine-root': { type: 'string' },
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
if (runs < 3 || frames < 90) throw new Error('At least 3 runs and 90 frames required');
const engineRoot = resolve(values['engine-root']),
  out = resolve(root, values.out);
if (
  !relative(resolve(root, '.mesure/out'), out) ||
  relative(resolve(root, '.mesure/out'), out).startsWith('..')
)
  throw new Error('Output must be a child of .mesure/out');
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
takeBenchLock('water cost');
const engineRoots = [
  engineRoot,
  ...(values['compare-engine-root'] ? [resolve(values['compare-engine-root'])] : []),
];
const engines = await Promise.all(
  engineRoots.map(async (path) => ({
    path,
    commit: git(path, 'rev-parse', 'HEAD'),
    dirty: git(path, 'status', '--porcelain'),
    run: await waterCostRun(root, path),
  })),
);
// One control pair per repeat: baseline on/off, or visible water on two engine revisions.
const controls =
  engines.length === 2
    ? [
        { engine: 0, enabled: true },
        { engine: 1, enabled: true },
      ]
    : [
        { engine: 0, enabled: false },
        { engine: 0, enabled: true },
      ];
const rows: {
  run: number;
  engine: number;
  engineCommit: string;
  fraction: number;
  moving: boolean;
  enabled: boolean;
  reading: Reading;
}[] = [];
const errors: string[] = [];
const report = {
  protocol:
    engines.length === 2
      ? 'Interleaved engine revisions, identical visible water fixture'
      : 'Total water contribution: resident tile visible versus parked, not fullscreen overhead alone',
  sampling:
    'Serialized frames; earliest-to-latest GPU envelope and submitted spans reported separately; same-clear-colour redraw',
  displayMode: 'dawn-node',
  displayCapHz: null,
  engines: engines.map(({ path, commit, dirty }) => ({ path, commit, dirty })),
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
        for (const { engine, enabled } of repeat % 2 ? [...controls].reverse() : controls) {
          const options = { fraction, moving, enabled, frames, warmup };
          const pageErrors: string[] = [];
          const reading = await runOnDawn(
            (o: WaterCostOptions) => engines[engine].run(o),
            options,
            pageErrors,
          );
          errors.push(...pageErrors);
          rows.push({
            run: repeat + 1,
            engine,
            engineCommit: engines[engine].commit,
            fraction,
            moving,
            enabled,
            reading,
          });
          if ('unavailable' in reading) errors.push(String(reading.unavailable));
          else {
            errors.push(...reading.errors);
            if (reading.waterPassMismatches)
              errors.push('Water pass presence differs from requested control');
            if (reading.invalidSamples) errors.push('Invalid or truncated GPU timestamp samples');
            if (reading.samples.length < 30) errors.push('At least 30 valid GPU samples required');
            if (!reading.gpuEnvelopeMs) errors.push('No valid enclosing GPU frame samples');
            if (!reading.gpuFrameMs) errors.push('No valid GPU frame samples');
            if (reading.held) errors.push('Forced frames were held');
            if (reading.dpr !== 1) errors.push(`DPR must be 1, got ${reading.dpr}`);
            if (reading.size[0] !== 1280 || reading.size[1] !== 720)
              errors.push('Canvas size mismatch');
            if (reading.diagnostics.some((e) => /failed|lost|refused/.test(e.phase)))
              errors.push('Engine failure diagnostic');
          }
          if (errors.length) throw new Error(`Water measurement incomplete: ${errors.join('; ')}`);
          console.log(
            JSON.stringify({
              run: repeat + 1,
              engineCommit: engines[engine].commit,
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
      controls.map(({ engine, enabled }) => {
        const selected = rows.filter(
          (r) =>
            r.engine === engine &&
            r.fraction === fraction &&
            r.moving === moving &&
            r.enabled === enabled,
        );
        const envelopes = selected.flatMap(({ reading }) =>
          'gpuEnvelopeMs' in reading && reading.gpuEnvelopeMs ? [reading.gpuEnvelopeMs] : [],
        );
        const quantiles = selected.flatMap(({ reading }) =>
          'gpuFrameMs' in reading && reading.gpuFrameMs ? [reading.gpuFrameMs] : [],
        );
        return {
          engine,
          engineCommit: engines[engine].commit,
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
