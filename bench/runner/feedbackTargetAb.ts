#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { launchChrome } from './chrome.ts';
import { parseArgs, resolveMounts, sdkEntryUrl, VIEWS } from './options.ts';
import { assetsManifest, sceneDerived } from './scene.ts';
import { distribution } from './summary.ts';
import { passesGpu } from './seriesPasses.ts';
import { imageDiff } from './imageDiff.ts';
import { startServer, type Capture } from '../../tests/kit/server/staticServer.ts';
import { encodePng } from '../../packages/sdk-node/src/cutout/png.mts';
import type { FeedbackTargetResult } from './feedbackTargetPage.ts';
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const flags = parseArgs(process.argv.slice(2));
const scenes = (flags.get('scene') ?? 'sponza,alpha-blend-mode-test').split(',').filter(Boolean);
const views = (flags.get('vues') ?? 'generale,sol,rue').split(',').filter(Boolean);
const frames = Number(flags.get('images') ?? 120);
const pixelError = Number(flags.get('pixelError') ?? 0);
const output = resolve(flags.get('out') ?? join(ROOT, '.mesure/out/39-feedback-ab'));
const dist = resolve(flags.get('dist') ?? join(ROOT, 'dist'));
const rebuild = (flags.get('rebuild-cache') ?? '').split(',').filter(Boolean);
if (!Number.isInteger(frames) || frames < 12) throw new Error('--images must be at least 12');
if (!Number.isFinite(pixelError) || pixelError < 0)
  throw new Error('--pixelError must be nonnegative');
for (const view of views) if (!(view in VIEWS)) throw new Error(`unknown view: ${view}`);
for (const scene of rebuild)
  if (!scenes.includes(scene))
    throw new Error(`--rebuild-cache names a scene outside --scene: ${scene}`);
type Reading = FeedbackTargetResult['readings'][number];
const namedPasses = (reading: Reading) => {
  const all = passesGpu(reading.gpuPassSamples);
  return Object.fromEntries(
    [
      'Trillion3D material surfaces v1',
      'Trillion3D transparents',
      'Trillion3D water surfaces',
      'Trillion3D texture feedback reduce',
    ].map((name) => [name, all?.passes.find((pass) => pass.name === name)?.gpuMs ?? null]),
  );
};
async function main() {
  await mkdir(output, { recursive: true });
  // The owned asset tool preserves source folders and compiles only missing derived caches.
  // An explicit rebuild refreshes a stale cache through that same route before Chrome opens.
  for (const scene of scenes) {
    const args = [
      'bench/runner/assets.ts',
      '--only',
      scene,
      ...(rebuild.includes(scene) ? ['--rebuild'] : []),
    ];
    const prepared = spawnSync('node', args, { cwd: ROOT, stdio: 'inherit' });
    if (prepared.error) throw prepared.error;
    if (prepared.status !== 0) throw new Error(`asset preparation failed for ${scene}`);
  }
  const side = { name: 'probe', dist, from: 'folder' };
  const captures = new Map<string, Capture>();
  const { server, port } = await startServer({
    mounts: resolveMounts(ROOT, [side]),
    captures,
  });
  const report = {
    command: `node bench/runner/feedbackTargetAb.ts ${process.argv.slice(2).join(' ')}`,
    head: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    size: { width: 2496, height: 1404, dpr: 1 },
    frames,
    pixelError,
    taa: true,
    dist,
    runs: [] as unknown[],
  };
  try {
    for (const scene of scenes) {
      const manifestUrl = assetsManifest(scene, true);
      const browser = await launchChrome({
        headless: flags.get('visible') !== 'true',
        args: [
          '--enable-unsafe-webgpu',
          '--enable-gpu-benchmarking',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
        ],
      });
      try {
        const page = await browser.newPage({
          viewport: { width: 2496, height: 1404 },
          deviceScaleFactor: 1,
        });
        const incidents: string[] = [];
        page.on('pageerror', (error) => incidents.push(String(error)));
        page.on('console', (message) => {
          if (message.type() === 'error') incidents.push(message.text());
        });
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
        for (const view of views) {
          const raw = await page.evaluate(
            async (options) => {
              const module = await import('/runner/feedbackTargetPage.ts');
              return module.runFeedbackTarget(options);
            },
            {
              sdkUrl: sdkEntryUrl(side),
              manifestUrl,
              scene,
              view: VIEWS[view as keyof typeof VIEWS].index,
              frames,
              pixelError,
            },
          );
          if (!raw.supported) {
            report.runs.push({ scene, view, supported: false, reason: raw.reason, incidents });
            continue;
          }
          const readings = raw.readings.map((reading, index) => ({
            label: ['A1', 'B', 'A2'][index],
            target: reading.target,
            gpuFrameMs: distribution(reading.gpuFrameMs),
            gpuSamples: reading.gpuFrameMs.length,
            passes: namedPasses(reading),
            gpuPassSamples: reading.gpuPassSamples.length,
            counters: reading.counters,
            capture: reading.capture.replace(/\.rgba$/, '.png'),
          }));
          for (const reading of raw.readings) {
            const capture = captures.get(reading.capture);
            if (capture)
              await writeFile(
                join(output, reading.capture.replace(/\.rgba$/, '.png')),
                encodePng(capture.w, capture.h, capture.body, true),
              );
          }
          const [a1, b, a2] = raw.readings;
          const aa = imageDiff(captures.get(a1.capture), captures.get(a2.capture));
          const ab = imageDiff(captures.get(a1.capture), captures.get(b.capture));
          const onBytes = a1.counters.gpuFrameTargetBytes ?? null;
          const offBytes = b.counters.gpuFrameTargetBytes ?? null;
          const feedbackBytes = 2496 * 1404 * 4;
          const onP50 = readings[0].gpuFrameMs?.p50 ?? null;
          const offP50 = readings[1].gpuFrameMs?.p50 ?? null;
          const againP50 = readings[2].gpuFrameMs?.p50 ?? null;
          const spread = onP50 !== null && againP50 !== null ? Math.abs(onP50 - againP50) : null;
          const delta =
            onP50 !== null && offP50 !== null && againP50 !== null
              ? (onP50 + againP50) / 2 - offP50
              : null;
          const sameImage =
            aa && ab && 'pixels' in aa && 'pixels' in ab && aa.pixels === 0 && ab.pixels === 0;
          const resident =
            raw.readings.every(
              (r) =>
                r.counters.textureTilesPending === 0 &&
                r.counters.textureMissingLevels === 0 &&
                r.counters.textureTilesRequested === r.counters.textureTilesAtLevel &&
                r.counters.pagesLoading === 0 &&
                r.counters.uncoveredTriangles === 0,
            ) &&
            raw.readings.every(
              (r) =>
                r.counters.residentPages === a1.counters.residentPages &&
                r.counters.textureTilesResident === a1.counters.textureTilesResident,
            );
          const bytesValid =
            onBytes !== null && offBytes !== null && onBytes - offBytes === feedbackBytes;
          const timed = readings.every((r) => r.gpuFrameMs !== null && r.gpuSamples > 0);
          const eligible = sameImage && resident && bytesValid && timed;
          report.runs.push({
            scene,
            view,
            supported: true,
            pose: raw.pose,
            readings,
            aa,
            ab,
            feedbackBytes,
            feedbackTargetShare: onBytes ? feedbackBytes / onBytes : null,
            spread,
            delta,
            gates: { sameImage, resident, bytesValid, timed },
            parityValid: eligible,
            beyondSpread: eligible && delta !== null && spread !== null ? delta > spread : null,
            incidents: [...incidents],
            cache: sceneDerived(scene),
          });
        }
        await page.close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((done) => server.close(done));
  }
  await writeFile(join(output, 'feedback-target-ab.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`Feedback A/B/A: ${join(output, 'feedback-target-ab.json')}\n`);
}
await main().catch((error) => {
  process.stderr.write(String(error?.stack ?? error) + '\n');
  process.exitCode = 1;
});
