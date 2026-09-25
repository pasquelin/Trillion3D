#!/usr/bin/env node
// =====================================================================================
// Measurement benchmark common to all batches. One command, no server to start manually:
//
//   node bench/runner/bench.ts --moteur webgl --avant <ref-git|dist> --apres <ref-git|dist> \
//        --vues generale,sol,rue --images 60 --pixelError 0,1 --max-pages 100000
//
// `--moteur` is `webgl`, `webgpu` or `webgl2`; `--moteur-avant` and `--moteur-apres` redefine it
// per side, setting an engine against Three witness in a single run,
// same poses, same lights, same cache. All options described in `README.md`.
//
// Harness writes `mesure.json`, `resume.md` and one PNG per view, per threshold and per side, plus
// A/A witness capture. A field is `null` when not measured: nothing is inferred.
// Each series runs in a fresh page: previous WebGL context and heap are returned to browser
// before next requests one.
// Everything it launches — static server, Chromium — it stops, including on error.
//
// NO SERIOUS TIMING IS PROMISED HERE: harness records durations and machine load at start/end
// of each series. Caller judges if machine was quiet.
// =====================================================================================
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from './chrome.ts';
import * as options from './options.ts';
import { startServer, type Capture } from '../../tests/kit/server/staticServer.ts';
import { resume } from './summary.ts';
import { measurementProvenance } from './report/provenance.ts';
import { recordInputs, recordCuts } from './report/evidence.ts';
import { playViews } from './viewSeries.ts';
import { FLUIDS_SCENE } from './scene.ts';
import { fluidsLines, runFluids } from './fluids.ts';
import { limitsLines } from './limits.ts';
import type * as Limits from './limits.ts';
import type { Report, RunContext } from './report/types.ts';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const {
  settings,
  views,
  out: OUT,
  flags,
  resources,
} = options.readOptions(process.argv.slice(2), ROOT);
const CTX: RunContext = { MANIFEST: null, OUT, settings, lights: null, poses: null };

async function main() {
  await mkdir(OUT, { recursive: true });
  const rawSides = options.resolveSides({
    after: flags.get('apres'),
    before: flags.get('avant'),
    root: ROOT,
  });
  // Each side has its compiled cache (`--cache-<side>`, otherwise benchmark asset cache), engine
  // (`--moteur-<side>`, Chromium flags being union) and variant (`--variante-<side>`).
  // `--scene name` sets asset cache before equipping sides: campaign thus runs each reference scene without repeating `--cache-*` paths.
  options.applySceneFlag(flags);
  const sides = rawSides.map((side) => options.equipSide(side, flags, settings));
  const FLAGS = [...new Set(sides.flatMap((side) => side.engine.flags))];
  // Measured scene is from named caches; without any, benchmark reference scene. The fluids
  // scene is built in the page (`fluids.ts`): it reads no cache.
  const fluids = flags.get('scene') === FLUIDS_SCENE;
  const scene = fluids ? FLUIDS_SCENE : options.sceneOf(sides.find((side) => side.cache)?.cache);
  const MANIFEST = options.assetsManifest(scene, !fluids && sides.some((side) => !side.cache));
  CTX.MANIFEST = MANIFEST;
  for (const side of sides) {
    side.manifestUrl = side.cache ? `/cache/${side.name}/native/full/manifest.json` : MANIFEST;
    side.sourceUrl = side.engine.source === 'gltf' ? options.sceneGltf(scene) : null;
  }
  const captures = new Map<string, Capture>();
  const mounts = options.resolveMounts(ROOT, sides, resources);

  const report: Report = {
    startedAt: new Date().toISOString(),
    provenance: measurementProvenance(),
    campaignIdentity: process.env.TRILLION3D_CAMPAIGN_IDENTITY ?? null,
    commande: `node bench/runner/bench.ts ${process.argv.slice(2).join(' ')}`,
    head: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    scene,
    engine: settings.engine,
    pathVersion: options.PATH_VERSION,
    settings,
    flags: FLAGS,
    ressources: resources,
    sides: Object.fromEntries(sides.map(options.sideReport)),
    series: [],
    errors: [],
  };

  await recordInputs(report, sides);
  const { server, port } = await startServer({
    port: settings.port,
    mounts,
    captures,
    isolation: settings.isolation,
  });
  report.settings = { ...settings, port };
  // Fresh browser per series, closed immediately after. A large scene leaves several hundred MB
  // in Chromium GPU process; closing page does not release them, causing 3rd series to fail
  // ("WebGL2 unavailable"). Relaunching browser frees GPU process between series.
  const onFreshPage = async <T>(run: (page: Page) => Promise<T>): Promise<T> => {
    const browser = await launchChrome({ headless: !settings.visible, args: FLAGS });
    report.provenance.browser = browser.version();
    const page = await browser.newPage({
      viewport: { width: settings.width, height: settings.height },
    });
    page.on('pageerror', (e) =>
      report.errors.push({ kind: 'pageerror', message: String(e.message) }),
    );
    page.on('response', (r) => {
      if (r.status() >= 400) report.errors.push({ kind: 'http', status: r.status(), url: r.url() });
    });
    page.on('console', (m) => {
      if (m.type() === 'error')
        report.errors.push({ kind: 'console', message: m.text().slice(0, 400) });
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    try {
      return await run(page);
    } finally {
      await page.close();
      await browser.close();
    }
  };
  try {
    // The browser limits, with every run: served under `/runner/`, imported by the page.
    report.limits = await onFreshPage((page) =>
      page.evaluate(
        async ({ module, sdkUrl }) => ((await import(module)) as typeof Limits).probeLimits(sdkUrl),
        { module: '/runner/limits.ts', sdkUrl: options.sdkEntryUrl(sides[0]) },
      ),
    );
    if (!fluids) await playViews(CTX, report, sides, views, captures, onFreshPage);
    else
      for (const side of sides)
        (report.fluids ??= []).push(
          await onFreshPage((page) => runFluids(page, side, settings, OUT, captures)),
        );
  } finally {
    await new Promise((done) => server.close(done));
  }

  report.finishedAt = new Date().toISOString();
  recordCuts(report, sides, OUT);
  await writeFile(join(OUT, 'mesure.json'), JSON.stringify(report, null, 1));
  const appendix = [...limitsLines(report.limits), ...fluidsLines(report.fluids)].join('\n');
  await writeFile(join(OUT, 'resume.md'), `${resume(report)}\n${appendix}\n`);
  process.stdout.write(`\nJSON: ${join(OUT, 'mesure.json')}\nSummary: ${join(OUT, 'resume.md')}\n`);
  if (report.errors.length) {
    process.stdout.write(`${report.errors.length} page error(s) recorded in the JSON\n`);
    process.exitCode = 1;
  }
}

await main().catch((error) => {
  process.stderr.write(String((error && error.stack) || error) + '\n');
  process.exitCode = 1;
});
