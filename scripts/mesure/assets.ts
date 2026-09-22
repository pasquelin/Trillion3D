#!/usr/bin/env node
// =====================================================================================
// The bench's assets, in one command: fetch the public sample models, then compile the cache each
// scene is measured through.
//
//   node scripts/mesure/assets.ts [--only sponza,duck] [--list]
//
// Both steps are idempotent. A scene folder already under `.mesure/assets/` is kept as it is — the
// sources are never written to — and a `<scene>-derived/` cache whose `native/full/manifest.json`
// is there is not compiled again. Deleting a cache folder is how one asks for it to be rebuilt.
//
// `--only` limits both steps to the named scenes; a name that is not a catalogue model is still
// compiled if its folder is on disk, which is how a generated facade (`scenes/facade.ts`) is
// compiled like any other scene.
// =====================================================================================
import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { availableParallelism, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from './options.ts';
import { ASSETS, sceneDerived } from './scene.ts';
import { SAMPLE_MODELS, kebab, sceneGltfFile, scenesOnDisk } from './assetsCatalogue.ts';
import { fetchModels } from './assetsFetch.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'dist/sdk-node/cli.mjs');
const COMPILER =
  process.env.WEB_GEOMETRY_COMPILER_BIN ??
  join(ROOT, 'packages/asset-compiler-rust/target/release/web-geometry-compiler');
/** The triangle budget of a `full` cache, as `README.md` § Assets states it for every scene. */
const TRIANGLE_BUDGET = '150000';

/**
 * What a compile job is given of the machine, read off the machine and never chosen by hand:
 * every core it reports as usable, and half its physical memory as the admission budget — the
 * other half is what the OS, the browser and the rest of the session keep. Both are printed with
 * each job, so a cache carries the shape of the machine that cooked it.
 */
export function machineBudget(parallelism = availableParallelism(), bytes = totalmem()) {
  return { threads: Math.max(1, parallelism), ramMb: Math.max(1, Math.floor(bytes / 2 / 2 ** 20)) };
}

/**
 * What the run touches. Without `--only`: every catalogue model is fetched and every scene on disk
 * is compiled. With it: only the named scenes, in the order given — a name outside the catalogue
 * is fetched by nobody and compiled from the folder it already has.
 */
export function selectedScenes(only: string | undefined, onDisk: string[], models: string[]) {
  if (!only || only === 'true') return { fetch: models, compile: onDisk };
  const asked = only.split(',').filter(Boolean);
  return { fetch: models.filter((name) => asked.includes(kebab(name))), compile: asked };
}

const cacheReady = (scene: string) =>
  existsSync(join(sceneDerived(scene), 'native/full/manifest.json'));

/** One compile job, with the repository's own compiler and the README's own arguments. */
function compile(scene: string, budget: ReturnType<typeof machineBudget>) {
  const source = join(ASSETS, scene);
  const gltf = sceneGltfFile(source);
  if (!gltf) throw new Error(`no glTF under ${source}: nothing to compile`);
  const args = [
    CLI,
    join(source, gltf),
    sceneDerived(scene),
    'full',
    TRIANGLE_BUDGET,
    `/benchmark-assets/${scene}/`,
    String(budget.threads),
    String(budget.ramMb),
    'qem-endpoints',
  ];
  const run = spawnSync('node', args, {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, WEB_GEOMETRY_COMPILER_BIN: COMPILER },
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`compiling ${scene} failed (${run.status})`);
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const known = Object.keys(SAMPLE_MODELS);
  if (flags.has('list')) {
    for (const [name, purpose] of Object.entries(SAMPLE_MODELS))
      process.stdout.write(`${kebab(name).padEnd(28)} ${purpose}\n`);
    return;
  }
  mkdirSync(ASSETS, { recursive: true });
  const only = flags.get('only');
  const wanted = selectedScenes(only, scenesOnDisk(ASSETS), known);
  const fetched = fetchModels(ASSETS, wanted.fetch);
  process.stdout.write(
    fetched.length ? `fetched: ${fetched.join(', ')}\n` : 'fetched: nothing missing\n',
  );
  // Recomputed after the fetch: what it just wrote is a scene to compile like the others.
  const scenes = only && only !== 'true' ? wanted.compile : scenesOnDisk(ASSETS);
  const todo = scenes.filter((scene) => !cacheReady(scene));
  for (const scene of scenes.filter(cacheReady)) process.stdout.write(`cache ready: ${scene}\n`);
  if (todo.length === 0) return;
  if (!existsSync(CLI)) throw new Error(`compiler CLI absent: ${CLI} — run \`pnpm run build\``);
  if (!existsSync(COMPILER))
    throw new Error(`native compiler absent: ${COMPILER} — run \`pnpm run build:native\``);
  const budget = machineBudget();
  for (const scene of todo) {
    process.stdout.write(
      `compiling ${scene} (${budget.threads} threads, ${budget.ramMb} MiB admitted)\n`,
    );
    const started = Date.now();
    compile(scene, budget);
    process.stdout.write(`compiled ${scene} in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
