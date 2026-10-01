#!/usr/bin/env node
// S3's standalone GPU experiments; the recette runs measurements, never unit-test imports.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { onFreshPage } from '../bench/runner/chrome.ts';
import { ENGINES } from '../bench/runner/sideOptions.ts';
import { startServer } from '../tests/kit/server/staticServer.ts';
import { canvasDimensions, s3Cases, validateOptions } from '../bench/fluids/s3/matrix.ts';
import type { S3Options, S3Result } from '../bench/fluids/s3/contracts.ts';
import type { runS3Case } from '../bench/fluids/s3/page.ts';
import { summarize } from '../packages/sdk-core/src/runtime/stats.ts';

const statistics = (result: S3Result) => ({
  cpuMs: summarize(result.cpuFrameMs),
  gpuMs: summarize(result.gpuFrameMs.map(({ ms }) => ms)),
  rafMs: summarize(result.rafIntervalMs),
  gpuSamples: result.gpuFrameMs.length,
  requestedFrames: result.options.frames,
});

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    list: { type: 'boolean', default: false },
    case: { type: 'string' },
    repeats: { type: 'string', default: '5' },
    frames: { type: 'string', default: '180' },
    warmup: { type: 'string', default: '60' },
    width: { type: 'string', default: '1280' },
    height: { type: 'string', default: '720' },
    dpr: { type: 'string', default: '1' },
    visible: { type: 'boolean', default: false },
    out: { type: 'string', default: '.mesure/out/421/s3.json' },
  },
});
function integer(name: keyof typeof values, minimum: number, maximum: number) {
  const value = Number(values[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(`--${name} must be an integer from ${minimum} through ${maximum}`);
  return value;
}
const cases = s3Cases();
const selected =
  values.case === undefined
    ? cases.map((_, index) => index)
    : [integer('case', 0, cases.length - 1)];
const repeats = integer('repeats', 5, 20);
const frames = integer('frames', 30, 36000);
const warmup = integer('warmup', 1, 3600);
const width = integer('width', 64, 4096);
const height = integer('height', 64, 4096);
const dpr = Number(values.dpr);
if (!Number.isFinite(dpr) || dpr <= 0 || dpr > 4) throw new Error('--dpr must be in (0, 4]');
canvasDimensions(width, height, dpr);
for (const index of selected)
  validateOptions({ case: cases[index], enabled: true, width, height, warmup, frames });

if (values.list) {
  console.log(
    JSON.stringify(
      selected.map((index) => ({ index, ...cases[index] })),
      null,
      2,
    ),
  );
} else {
  const output = resolve(root, values.out);
  const outputRoot = resolve(root, '.mesure/out/421');
  const below = relative(outputRoot, output);
  if (!below || below === '..' || below.startsWith(`..${sep}`))
    throw new Error('--out must name a file under .mesure/out/421');
  await mkdir(resolve(output, '..'), { recursive: true });
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const report = {
    issue: 421,
    utc: new Date().toISOString(),
    commit: git('rev-parse', 'HEAD'),
    dirty: git('status', '--porcelain') !== '',
    command: ['node', 'scripts/bench-fluid-s3.ts', ...process.argv.slice(2)],
    machine: { platform: platform(), release: release(), cpu: cpus()[0]?.model, ram: totalmem() },
    settings: { width, height, dpr, frames, warmup, repeats, headless: !values.visible },
    status: 'running',
    failure: null as string | null,
    note: 'Candidate experiments only. Retained tiers require reviewed GPU results and spread.',
    runs: [] as {
      index: number;
      repeat: number;
      enabled: boolean;
      browser: string;
      result: S3Result;
      statistics: ReturnType<typeof statistics>;
    }[],
  };
  const save = () => writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await save();
  const { server, port } = await startServer({
    mounts: ['bench', 'packages', 'scripts'].map((name) => ({
      prefix: `/${name}/`,
      dir: resolve(root, name),
    })),
  });
  try {
    for (const index of selected) {
      const candidate = cases[index];
      for (let repeat = 0; repeat < repeats; repeat++) {
        // Reverse A/B order on alternate repetitions to expose warmup/drift bias.
        for (const enabled of repeat % 2 ? [true, false] : [false, true]) {
          const errors: string[] = [];
          let browserVersion = '';
          const options: S3Options = { case: candidate, enabled, width, height, warmup, frames };
          const result = await onFreshPage(
            { headless: !values.visible, args: ENGINES[candidate.backend].flags },
            { url: `http://127.0.0.1:${port}/`, width, height, dpr },
            (page) =>
              page.evaluate(
                async ({ module, options }) =>
                  ((await import(module)) as { runS3Case: typeof runS3Case }).runS3Case(options),
                { module: '/bench/fluids/s3/page.ts', options },
              ),
            (page, browser) => {
              browserVersion = browser.version();
              page.on('pageerror', (error) => errors.push(error.message));
            },
          );
          if (errors.length) throw new Error(`S3 page failed: ${errors.join('; ')}`);
          report.runs.push({
            index,
            repeat,
            enabled,
            browser: browserVersion,
            result,
            statistics: statistics(result),
          });
          await save();
          console.log(`case ${index}, repeat ${repeat + 1}, enabled ${enabled}: recorded`);
        }
      }
    }
    report.status = report.runs.every(
      ({ result, statistics }) => result.status === 'measured' && statistics.gpuMs !== null,
    )
      ? 'complete'
      : 'incomplete';
    if (report.status === 'incomplete') process.exitCode = 2;
  } catch (error) {
    report.status = 'failed';
    report.failure = String(error);
    throw error;
  } finally {
    await save();
    server.close();
  }
}
