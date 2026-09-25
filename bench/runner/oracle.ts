#!/usr/bin/env node
// =====================================================================================
// Rebound oracle campaign: converged indirect irradiance of the engine compared against
// the compiler path tracer. Single command, no manual server launch required:
//
//   node bench/runner/oracle.ts --cache .mesure/cache-piece --source piece/piece.gltf \
//        --ressources piece --largeur 160 --hauteur 120 --lampes 1 --samples 256 --visible
//
// Engine and oracle receive identical pose, lights, and size. Engine renders `bounce` view —
// raw indirect irradiance multiplied by exposure. Oracle computes same value on source triangles.
// NO TIMING PROMISED HERE: this is a fidelity measurement, not a speed test.
// =====================================================================================
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { CameraPose } from '../../packages/sdk-core/src/index.ts';
import { launchChrome } from './chrome.ts';
import * as options from './options.ts';
import { startServer, type Capture } from '../../tests/kit/server/staticServer.ts';
import { readBounds } from './page.ts';
import { benchLights } from './lamps.ts';
import { oracleBuilt } from './oracleCompare.ts';
import { machineLoad } from './summary.ts';
import { runView } from './oracleView.ts';
import type { OracleSettings, VueOracle } from './oracleView.ts';
import { sdkEntryUrl } from './dists.ts';
import { measureOutput } from '../core/paths.ts';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const args = process.argv.slice(2);
// Same flag reader as benchmark: `--name value`, `--name=value`, `--name` alone.
const flags = options.parseArgs(args);
function flag(name: string): string | undefined;
function flag(name: string, fallback: string): string;
function flag(name: string, fallback?: string): string | undefined {
  return flags.get(name) ?? fallback;
}
const number = (name: string, fallback: number) => Number(flag(name, String(fallback)));

/** Three comma-separated numbers, or null. Used for manual poses. */
const triple = (name: string): [number, number, number] | null => {
  const value = flag(name);
  if (!value || value === 'true') return null;
  const parts = value.split(',').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part)))
    throw new Error(`--${name} expects three comma-separated numbers`);
  return parts as [number, number, number];
};

async function main() {
  const cache = options.resolveCache(flag('cache'));
  if (!cache) throw new Error('--cache is required: the compiled cache derived directory');
  const source = resolve(flag('source', ''));
  if (!existsSync(source)) throw new Error(`--source not found: ${source}`);
  if (!oracleBuilt(ROOT)) throw new Error('oracle missing: run `pnpm run build:native`');
  const out = resolve(flag('out', measureOutput(`oracle-${Date.now()}`)));
  await mkdir(out, { recursive: true });
  const settings: OracleSettings = {
    width: number('largeur', 160),
    height: number('hauteur', 120),
    samples: number('samples', 256),
    bounces: number('bounces', 2),
    exposure: number('exposition', 0.2),
    converge: number('converge', 24),
    delayFrames: number('images-retard', 40),
    delayMargin: number('marge-retard', 1.2),
    floor: number('plancher', 0.01),
    cadenceHz: number('cadence', 60),
    lamps: number('lampes', 1),
    // Same generic rule as benchmark: point light intensity is a measurement option.
    intensity: number('intensite', 40),
    rangeFactor: number('portee', 0.75),
    shadows: flag('ombres', 'on') === 'on',
    pixelError: number('pixelError', 0),
    maxPages: number('max-pages', 100000),
    source,
  };
  const sides = options.resolveSides({ after: flag('apres'), root: ROOT });
  const side = sides[0];
  side.cache = cache;
  const manifestUrl = `/cache/${side.name}/native/full/manifest.json`;
  side.manifestUrl = manifestUrl;
  const resources = flag('ressources');
  const mounts = options.resolveMounts(ROOT, sides, resources ? resolve(resources) : null);
  const captures = new Map<string, Capture>();
  const { server, port } = await startServer({ mounts, captures });
  const browser = await launchChrome({
    headless: flag('visible', 'false') !== 'true',
    args: options.ENGINES.webgpu.flags,
  });
  const report: {
    startedAt: string;
    commande: string;
    head: string;
    settings: typeof settings;
    charge: { avant: number[]; apres?: number[] };
    vues: VueOracle[];
  } = {
    startedAt: new Date().toISOString(),
    commande: `node bench/runner/oracle.ts ${args.join(' ')}`,
    head: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    settings,
    charge: { avant: machineLoad() },
    vues: [],
  };
  try {
    const page = await browser.newPage({
      viewport: { width: settings.width, height: settings.height },
    });
    page.on('pageerror', (error) => report.vues.push({ erreur: String(error) }));
    // A rejected shader does not come through `pageerror`: it logs as console warning/error.
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning')
        console.error('[page]', m.type(), m.text().slice(0, 600));
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    const bounds = await page.evaluate(readBounds, {
      sdkUrl: sdkEntryUrl(side),
      manifestUrl,
    });
    const lights = benchLights(bounds, {
      lights: settings.lamps,
      lightShadows: settings.shadows,
      lightIntensity: settings.intensity,
      lightRangeFactor: settings.rangeFactor,
      sun: false,
      movingLight: false,
    });
    const movingCandidate = lights && lights.lights.find((light) => light.kind === 'point');
    if (!lights || !movingCandidate || !movingCandidate.position)
      throw new Error('--lampes must declare at least one point light');
    const moving = { id: movingCandidate.id, position: movingCandidate.position };
    // Light step: clear enough that rebound must reconverge.
    const step = number('pas', Math.max(1, (bounds.max.x - bounds.min.x) * 0.25));
    const camera = triple('pose'),
      target = triple('cible');
    for (const view of flag('vues', 'generale').split(',')) {
      // Manual pose overrides benchmark trajectory.
      const known = options.VIEWS[view as keyof typeof options.VIEWS];
      if (!known && !camera) throw new Error(`vue inconnue : ${view}`);
      const pose: CameraPose = camera
        ? { ...options.poseAt(bounds, 0), position: camera, target: target ?? [0, 0, 0] }
        : options.poseAt(bounds, known.index);
      report.vues.push(
        await runView(page, {
          side,
          manifestUrl,
          settings,
          pose,
          view,
          lights,
          moving,
          step,
          out,
          captures,
          root: ROOT,
        }),
      );
    }
  } finally {
    await browser.close();
    server.close();
  }
  report.charge.apres = machineLoad();
  await writeFile(join(out, 'oracle.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  if (report.vues.some((view) => view.erreur)) process.exitCode = 1;
}

await main();
