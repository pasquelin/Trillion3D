#!/usr/bin/env node
// Measurement benchmark common to all batches. One command, no server to start manually:
//   node bench/runner/bench.ts --engine webgl --before <ref-git|dist> --after <ref-git|dist> \
//        --views overview,ground,street --images 60 --pixelError 0,1 --max-pages 100000
// All options in `README.md`. Writes `measure.json`, `resume.md` and one PNG per view, threshold and
// side, plus A/A capture. `null` = not measured, never inferred; a black capture is an error.
// Everything it launches it stops, including on error. NO SERIOUS TIMING IS PROMISED HERE: it
// records machine load at each series boundary. Caller judges if the machine was quiet.
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Page } from 'playwright';
import { onFreshPage } from './chrome.ts';
import * as options from './options.ts';
import { startServer, type Capture } from '../../tests/kit/server/staticServer.ts';
import { readStreet } from './street.ts';
import { imageDiff } from './imageDiff.ts';
import { benchLights } from './lamps.ts';
import { measurementProvenance } from './report/provenance.ts';
import { recordInputs } from './report/evidence.ts';
import { runSerie } from './series/series.ts';
import { runGazeSeries } from './gazeNetworkRun.ts';
import { publish } from './benchPublish.ts';
import { readsCache } from './assets/scene.ts';
import { runFluids } from './fluids.ts';
import { readLimits } from './limits.ts';
import { againstReference, sceneReference } from './referenceProof.ts';
import type { Report, RunContext, Serie } from './report/types.ts';

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
  const { sides, scene, after, before } = options.equipSides(flags, settings);
  // `--reference`: the class-2 proof, each capture against the scene's reference image.
  const proof = flags.get('reference') === 'true';
  // Every option is read by now: a misspelt or retired flag stops the run before any build.
  flags.refuseUnread();
  await mkdir(OUT, { recursive: true });
  const dists = options.resolveSides({ after, before, root: ROOT });
  for (const side of sides)
    Object.assign(
      side,
      dists.find((dist) => dist.name === side.name),
    );
  const FLAGS = [...new Set(sides.flatMap((side) => side.engine.flags))];
  if (settings.gazeNetwork && !readsCache(scene))
    throw new Error('--gaze-network requires a compiled cache scene');
  if (settings.gazeNetwork && sides.some((side) => side.engine.id !== 'webgpu-page-raster'))
    throw new Error('--gaze-network requires the WebGPU page engine on every side');
  const MANIFEST = options.assetsManifest(
    scene,
    readsCache(scene) && sides.some((side) => !side.cache),
  );
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
    command: `node bench/runner/bench.ts ${process.argv.slice(2).join(' ')}`,
    head: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    scene,
    engine: settings.engine,
    pathVersion: options.PATH_VERSION,
    settings,
    flags: FLAGS,
    resources,
    sides: Object.fromEntries(sides.map(options.sideReport)),
    series: [],
    errors: [],
  };

  if (proof && settings.gazeNetwork)
    throw new Error('--reference holds still captures: it does not run with --gaze-network');
  const reference = proof ? sceneReference(report, undefined, views) : null;
  await recordInputs(report, sides);
  const { server, port } = await startServer({
    port: settings.port,
    mounts,
    captures,
    isolation: settings.isolation,
  });
  report.settings = { ...settings, port };
  // Fresh browser per series, closed immediately after (`onFreshPage`): the GPU process a large
  // scene fills is freed between series, or the 3rd one fails ("WebGL2 unavailable").
  const { width, height, dpr } = settings;
  const target = { url: `http://127.0.0.1:${port}/`, width, height, dpr };
  const onPage = <T>(run: (page: Page) => Promise<T>): Promise<T> =>
    onFreshPage({ headless: !settings.visible, args: FLAGS }, target, run, (tab, browser) => {
      report.provenance.browser = browser.version();
      tab.on('pageerror', (e) =>
        report.errors.push({ kind: 'pageerror', message: String(e.message) }),
      );
      tab.on('response', (r) => {
        if (r.status() >= 400)
          report.errors.push({ kind: 'http', status: r.status(), url: r.url() });
      });
      tab.on('console', (m) => {
        if (m.type() === 'error')
          report.errors.push({ kind: 'console', message: m.text().slice(0, 400) });
      });
    });
  try {
    report.limits = await onPage((page) => readLimits(page, options.sdkEntryUrl(sides[0])));
    if (!readsCache(scene)) {
      report.fluids = await runFluids(sides, onPage, settings, OUT, captures);
      return await publish(report, sides, captures, OUT);
    }
    const urls = {
      sdkUrl: options.sdkEntryUrl(sides[0]),
      manifestUrl: sides[0].manifestUrl ?? MANIFEST,
    };
    // The box, then the camera's street read off the model's own geometry, on one page: the poses
    // walk it (`poses.ts`).
    const bounds = (report.bounds = await onPage(async (page) => readStreet(page, urls)));
    // Lights once bounds are known: geometric rule, no named scene.
    CTX.lights = benchLights(bounds, settings);
    report.lights = CTX.lights ? CTX.lights.resume : null;
    if (settings.gazeNetwork) {
      report.gazeNetwork = await runGazeSeries(CTX, sides, views, bounds, onPage);
      return await publish(report, sides, captures, OUT);
    }
    for (const pixelError of settings.pixelErrors)
      for (const view of views) {
        const index = options.VIEWS[view].index;
        const pose = options.poseAt(bounds, index);
        // Moving camera: one pose per measured frame along benchmark trajectory.
        CTX.poses = settings.movingCamera
          ? options.trajectoryPoses(bounds, index, settings.frames)
          : null;
        const serie: Serie = {
          view,
          pixelError,
          segment: options.VIEWS[view].segment,
          index,
          pose,
          sides: {},
        };
        report.series.push(serie);
        const files: Record<string, string> = {};
        for (const side of sides) {
          const { row, captureFile } = await onPage((page) =>
            runSerie(CTX, page, side, view, pixelError, pose, captures),
          );
          serie.sides[side.name] = row;
          files[side.name] = captureFile;
        }
        // A/A witness: same side run twice, compared with itself. Shows what zero is.
        const witness = await onPage((page) =>
          runSerie(CTX, page, sides[0], view, pixelError, pose, captures, '-aa'),
        );
        serie.sides[`${sides[0].name}-aa`] = witness.row;
        serie.witnessAA = imageDiff(
          captures.get(files[sides[0].name]),
          captures.get(witness.captureFile),
        );
        serie.beforeAfterDiff = files.before
          ? imageDiff(captures.get(files.before), captures.get(files.after))
          : null;
        if (reference) serie.referenceDiff = againstReference(reference, serie, files, captures);
        const { before, after } = serie.sides;
        serie.sameCut = before && after ? before.selection.sha256 === after.selection.sha256 : null;
      }
  } finally {
    await new Promise((done) => server.close(done));
  }
  await publish(report, sides, captures, OUT);
}

await main().catch((error) => {
  process.stderr.write(String((error && error.stack) || error) + '\n');
  process.exitCode = 1;
});
