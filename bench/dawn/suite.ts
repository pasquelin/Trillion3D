// A series of bench runs under one lock, one page after the other, and the table of their first
// measured segments.
//   node bench/dawn/suite.ts [priority|reference|all|page[:scenario],…] [run options, as run.ts]
// `priority` (the default): five reference pages, one per cost the engine carries, for the work of
// every day. `reference`: the ten reference pages. `all`: those and the held-out validation pages
// (TRILLION3D_VALIDATION_DIR), for a big test — the validation pages are never tuned on.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { measureOutput } from '../core/paths.ts';
import { runChild } from './child.ts';
import { LOCK_OWNER, takeBenchLock } from './lock.ts';
import type { BenchReport } from './merge.ts';
import { stamp } from './options.ts';
import { ms, percent, sameImages, table } from './reportText.ts';

/** The reference pages and the scenario each plays: the car is driven, the rest orbited. */
const REFERENCE = [
  'a-crowd-of-characters',
  'shadows-through-see-through-panes',
  'from-clay-to-chrome',
  'drive-a-car:drive',
  'a-world-of-blocks',
  'a-field-of-pebbles',
  'floating-crates',
  'choose-your-quality',
  'a-hundred-thousand-instances',
  'a-dolly-along-the-canal',
];

/** One reference page per cost: the car (physics, terrain, chase camera), the worst sun shadow
 *  projection, dense instances, water and transparents, animated characters; TAA in all. */
const PRIORITY = [
  'drive-a-car:drive',
  'a-field-of-pebbles',
  'a-hundred-thousand-instances',
  'floating-crates',
  'a-crowd-of-characters',
];

/** The validation pages, by their prefix; the city flown by its page plays no gesture. */
function validation() {
  const dir = process.env.TRILLION3D_VALIDATION_DIR;
  if (!dir) return [];
  return readdirSync(dir)
    .filter((file) => /^v\d\d-.*\.html$/.test(file))
    .map((file) => file.slice(0, 3))
    .sort()
    .map((prefix) => (prefix === 'v09' ? `${prefix}:still` : prefix));
}

const options = process.argv.slice(2);
const list = options[0] && !options[0].startsWith('--') ? options.shift() : undefined;
const SETS: Record<string, () => string[]> = {
  priority: () => PRIORITY,
  reference: () => REFERENCE,
  all: () => [...REFERENCE, ...validation()],
};
const runs = SETS[list ?? 'priority']?.() ?? list!.split(',');
takeBenchLock(`suite of ${runs.length}`);

const rows: (string | number)[][] = [];
/** Runs that failed, or that measured with GPU errors (`run.ts` then ends 1): the suite fails. */
let failed = 0;
for (const run of runs) {
  const [page, scenario = 'orbit'] = run.split(':');
  console.error(`suite: ${page} ${scenario}`);
  const child = await runChild(
    [new URL('./run.ts', import.meta.url).pathname, page, '--scenario', scenario, ...options],
    { ...process.env, [LOCK_OWNER]: String(process.pid) },
    true,
    24 * 3600_000,
  );
  const report = /^report: (.*)\.md$/m.exec(child.stdout ?? '')?.[1];
  if (!report) {
    failed++;
    rows.push([page, scenario, `FAILED (${child.status ?? child.signal})`, ...Array(8).fill('')]);
    continue;
  }
  const merged = JSON.parse(readFileSync(`${report}.json`, 'utf8')) as BenchReport;
  if (child.status !== 0) failed++;
  const segment = merged.segments.find((s) => s.measured)!;
  const stages = segment.benchPasses
    .slice(0, 3)
    .map((pass) => `${pass.name} ${ms(pass.median)}`)
    .join(', ');
  rows.push([
    child.status === 0 ? page : `${page} (${merged.errors.length} GPU errors)`,
    scenario,
    ms(segment.gpuMs?.median),
    percent(segment.spread),
    ms(segment.engineGpuMs?.median),
    ms(segment.cpuMs?.median),
    ms(segment.worstGpuMs),
    ms(segment.worstCpuMs),
    segment.hitchFrames.map((at) => at.length).join('·'),
    stages,
    sameImages(segment),
  ]);
}
const head = ['page', 'scenario', 'GPU ms', 'plays spread', 'engine GPU ms', 'main thread ms'];
head.push('worst GPU ms', 'worst main thread ms', 'hitches', 'top passes', 'images');
const text = [`# GPU bench suite — ${new Date().toISOString()}`, '', table(head, rows), ''].join(
  '\n',
);
const path = measureOutput('bench-gpu', `${stamp()}-suite.md`);
writeFileSync(path, text);
console.log(text);
console.log(`suite: ${path}`);
process.exitCode = failed ? 1 : 0;
