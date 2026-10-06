#!/usr/bin/env node
// =====================================================================================
// The complete benchmark campaign: everything the benchmark can measure, run in a single command,
// each reference scene (`REFERENCE_SCENES` of `scene.ts`) then each run under
// `--out/<scene>/<name>/` (default `.mesure/out/global/`). A run whose directory already
// contains a `measure.json` is skipped to resume an interrupted campaign.
//
//   node bench/runner/campaign.ts [--out .mesure/out/global] [--scene a,b] [--only name,name] [--list]
//
// Each line names what it isolates: a single option distinguishes it from its neighbor, and it is
// this difference that is read in `summary/summaryGlobal.ts`. Resolutions, camera, sun, and baked textures
// are those of the backlog measurements so numbers remain comparable.
// =====================================================================================
import { launchChrome } from './harness/chrome.ts';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { campaignIdentity, canResume } from './report/provenance.ts';
import { parseArgs, scenesOf } from './harness/options.ts';
import { measureOutput } from '../core/paths.ts';

const ROOT = resolve(import.meta.dirname, '../..');
// Argument groups that lines name in one word, replaced at execution.
const GROUPS: Record<string, string> = {
  FULL: '--width 2496 --height 1404',
  QUARTER: '--width 1248 --height 702',
  ALL_VIEWS: '--views overview,ground,street,detail',
  TWO_VIEWS: '--views overview,ground',
  MOVING: '--sun --moving-camera',
  // Two sides on the same dist: the first carries the variant or engine making the difference.
  TWO_SIDES: '--before dist --after dist',
  BARE: '--engine-before three-nu --engine-after webgpu --before dist --after dist',
  LOD: '--engine-before three-lod --engine-after webgpu --before dist --after dist',
};
export const BASE = '--engine webgpu --images 60 --textures cache';

// One line per execution: `name | what it isolates | arguments`, uppercase groups.
const LINES = `
still | held frame: locked camera, no GPU work expected | ALL_VIEWS --pixelError 0,1,2 --sun FULL
mobile | campaign baseline: moving camera, sun, four views, two thresholds | ALL_VIEWS --pixelError 0,1 MOVING FULL
unlit | raw albedo: lighting cost by difference with \`mobile\` | ALL_VIEWS --pixelError 1 --moving-camera FULL
sun-no-shadows | sun without shadow maps: shadow-map cost by difference with \`mobile\` | TWO_VIEWS --pixelError 1 MOVING FULL --shadows off
res-1872 | 1872×1053 resolution | TWO_VIEWS --pixelError 1 MOVING --width 1872 --height 1053
res-1248 | 1248×702 resolution | TWO_VIEWS --pixelError 1 MOVING QUARTER
res-624 | 624×351 resolution | TWO_VIEWS --pixelError 1 MOVING --width 624 --height 351
res-1248-e0 | 1248×702 at threshold 0: triangles per pixel | TWO_VIEWS --pixelError 0 MOVING QUARTER
res-1248-e2 | 1248×702 at threshold 2 | TWO_VIEWS --pixelError 2 MOVING QUARTER
raster-1248 | compute raster (before, variant) vs hardware raster (after, default) at 1248×702 | TWO_SIDES --variant-before raster-compute TWO_VIEWS --pixelError 1 MOVING QUARTER
raster-2496 | compute raster vs hardware raster at 2496×1404 | TWO_SIDES --variant-before raster-compute TWO_VIEWS --pixelError 1 MOVING FULL
aa-off | no temporal antialiasing: accumulation cost and pixels by difference with \`mobile\` | TWO_VIEWS --pixelError 1 MOVING FULL --antialiasing off
profile-off | no per-step profile: profile cost and fidelity gate | TWO_VIEWS --pixelError 1 MOVING FULL --profile off
textures-host | textures from source images, not the cooked pyramid | TWO_VIEWS --pixelError 1 MOVING FULL --textures host
isolation | isolated page across origins: threaded physics path | TWO_VIEWS --pixelError 1 MOVING FULL --isolation on
math-js | batched math forced to JavaScript | TWO_VIEWS --pixelError 1 MOVING FULL --math-path js
math-wasm | batched math forced to WebAssembly | TWO_VIEWS --pixelError 1 MOVING FULL --math-path wasm
lights-4 | four point lights with shadows, plus the sun | TWO_VIEWS --pixelError 1 MOVING FULL --lights 4
lights-4-no-shadows | four point lights and sun with no shadows: map cost by difference | TWO_VIEWS --pixelError 1 MOVING FULL --lights 4 --shadows off
lights-16 | sixteen point lights with shadows | TWO_VIEWS --pixelError 1 MOVING FULL --lights 16
moving-light | locked camera, one moving light: cost of a shadow that redraws | --views ground --pixelError 1 --sun --lights 4 --moving-light FULL
bounce | bounce lighting on | TWO_VIEWS --pixelError 1 MOVING FULL --lights 4 --bounce on
instances-4 | four copies of the model | --views overview --pixelError 1 MOVING FULL --instances 4
instances-12 | twelve copies of the model | --views overview --pixelError 1 MOVING FULL --instances 12
pool-geo-8 | 8 MiB geometry pool: residency under extreme pressure, full image expected | ALL_VIEWS --pixelError 1 MOVING FULL --geometry-pool 8
pool-tex-64 | 64 MiB texture pool: one layer per atlas, coarse levels expected | ALL_VIEWS --pixelError 1 MOVING FULL --texture-pool 64
pool-4k | 3840×2160: targets follow resolution, no cap refuses | TWO_VIEWS --pixelError 1 MOVING --width 3840 --height 2160
witness-three | SDK Three witness (before) vs WebGPU engine (after), no shadows | --engine-before webgl --engine-after webgpu TWO_SIDES TWO_VIEWS --pixelError 1 --sun --shadows off FULL
webgl | WebGL engine (exact-cluster-pages) | --engine webgl ALL_VIEWS --pixelError 1 MOVING FULL
webgl2 | standalone WebGL2 engine (refusal expected if the cache carries blend) | --engine webgl2 TWO_VIEWS --pixelError 1 MOVING FULL
three-nu | Three vanilla (before) vs WebGPU engine (after), sun and shadows, moving camera | BARE ALL_VIEWS --pixelError 1 MOVING FULL
three-nu-1248 | Three vanilla vs the engine at 1248×702 | BARE TWO_VIEWS --pixelError 1 MOVING QUARTER
three-nu-no-shadows | Three vanilla vs the engine without shadows: materials and lighting fidelity | BARE TWO_VIEWS --pixelError 1 --sun --shadows off FULL
three-nu-lights-4 | Three vanilla vs the engine, sun and four shadowed point lights | BARE TWO_VIEWS --pixelError 1 MOVING FULL --lights 4
three-lod | Three with three LOD levels (before) vs WebGPU engine (after), sun and shadows, moving camera | LOD ALL_VIEWS --pixelError 1 MOVING FULL
three-lod-1248 | Three LOD vs the engine at 1248×702 | LOD TWO_VIEWS --pixelError 1 MOVING QUARTER
three-lod-no-shadows | Three LOD vs the engine without shadows | LOD TWO_VIEWS --pixelError 1 --sun --shadows off FULL
three-lod-lights-4 | Three LOD vs the engine, sun and four shadowed point lights | LOD TWO_VIEWS --pixelError 1 MOVING FULL --lights 4
visible | window open: cadence not capped at 60 Hz | TWO_VIEWS --pixelError 1 MOVING FULL --visible
`;

/** Words in an argument line, groups replaced. */
const words = (text: string): string[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => (GROUPS[word] ? GROUPS[word].split(' ') : [word]));

/** Executions in order: `[name, why, arguments beyond base]`. */
export const CAMPAIGN: [string, string, string[]][] = LINES.trim()
  .split('\n')
  .map((line) => line.split('|').map((field) => field.trim()))
  .map(([name, why, args]) => [name, why, words(args)]);

async function run(
  name: string,
  args: string[],
  out: string,
  log: string,
  scene: string,
  browserVersion: string,
) {
  const dir = join(out, scene, name);
  const identity = await campaignIdentity(
    ROOT,
    scene,
    [...BASE.split(' '), ...args],
    browserVersion,
  );
  if (existsSync(join(dir, 'measure.json'))) {
    if (canResume(JSON.parse(readFileSync(join(dir, 'measure.json'), 'utf8')), identity))
      return 'already measured';
    throw new Error(
      `Cannot resume ${scene}/${name}: identity changed or run incomplete; use a new --out directory.`,
    );
  }
  mkdirSync(dir, { recursive: true });
  const argv = [
    'bench/runner/bench.ts',
    ...BASE.split(' '),
    '--scene',
    scene,
    ...args,
    '--out',
    dir,
  ];
  const started = Date.now();
  const result = spawnSync(process.execPath, argv, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, TRILLION3D_CAMPAIGN_IDENTITY: identity },
  });
  appendFileSync(join(dir, 'campagne.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (result.status !== 0) process.exitCode = 1;
  const status = result.status === 0 ? 'ok' : `failed (${result.status})`;
  appendFileSync(
    log,
    `${new Date().toISOString()} ${scene}/${name} ${status} ${((Date.now() - started) / 1000).toFixed(0)} s\n`,
  );
  return status;
}

if (import.meta.filename === process.argv[1]) {
  const flags = parseArgs(process.argv.slice(2));
  const out = resolve(flags.get('out') ?? measureOutput('global'));
  const only = flags.get('only')?.split(',').filter(Boolean);
  const chosen = CAMPAIGN.filter(([name]) => !only || only.includes(name));
  const scenes = scenesOf(flags);
  const list = flags.has('list');
  flags.refuseUnread();
  if (list) {
    for (const scene of scenes)
      for (const [name, why] of chosen) console.log(`${`${scene}/${name}`.padEnd(36)} ${why}`);
    process.exit(0);
  }
  const browser = await launchChrome({ headless: true });
  const browserVersion = browser.version();
  await browser.close();
  mkdirSync(out, { recursive: true });
  const log = join(out, 'campagne.log');
  for (const scene of scenes)
    for (const [name, why, args] of chosen) {
      console.log(`▶ ${scene}/${name} — ${why}`);
      console.log(`  ${await run(name, args, out, log, scene, browserVersion)}`);
    }
}
