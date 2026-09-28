#!/usr/bin/env node
// The measured screen error of what WebGPU and WebGL2 draw, against the source (#959).
//
//   node bench/runner/screenError.ts --scene sponza --poses bench|orbit|terrain \
//     [--backends webgpu,webgl2] [--pixel-errors 0,1] [--out .mesure/out/959]
//
// Each (backend, threshold) opens one world in a fresh Chrome at 1728×1117, DPR 2, holds every
// pose until its cut is held and reads what it drew (`screenErrorPage.ts`); Node then measures
// it against the cache's source glTF (`screenErrorMeasure.ts`). The bound is the audit's:
// max ≤ pixelError + 0.1 px, forward and reverse. The scene is a compiled cache under the assets
// folder (`TRILLION3D_ASSETS`, `.mesure/assets` by default); one row per view is printed and the
// whole run written to `<out>/<scene>.json`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchChrome } from './chrome.ts';
import { readBounds } from './page.ts';
import { ENGINES, parseArgs, resolveMounts, resolveSides, sdkEntryUrl } from './options.ts';
import { sceneDerived } from './scene.ts';
import { auditPoses, benchPoses, type NamedPose, type PoseSet } from './screenErrorPoses.ts';
import { pageTriangles, sourceTriangles } from './screenErrorSurface.ts';
import { measureView } from './screenErrorMeasure.ts';
import type { HoldOptions } from './screenErrorPage.ts';
import { startServer, type Capture } from '../../tests/kit/server/staticServer.ts';
import { buildTriangleTree } from '../../packages/sdk-core/src/collision/triangleTree.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const [WIDTH, HEIGHT, DPR] = [1728, 1117, 2];
/** The audit's acceptance (E1): the drawn surface within a tenth of a pixel of the threshold. */
const MARGIN_PX = 0.1;
const PAGE = '/runner/screenErrorPage.ts';

const flags = parseArgs(process.argv.slice(2));
const scene = flags.get('scene'),
  set = flags.get('poses') as PoseSet | undefined;
if (!scene || !set || !['bench', 'orbit', 'terrain'].includes(set))
  throw new Error('usage: screenError.ts --scene <name> --poses bench|orbit|terrain');
const backends = (flags.get('backends') ?? 'webgpu,webgl2').split(',');
const thresholds = (flags.get('pixel-errors') ?? '0,1').split(',').map(Number);
const out = resolve(flags.get('out') ?? join(ROOT, '.mesure/out/959'));
mkdirSync(out, { recursive: true });

const sides = resolveSides({ root: ROOT });
const sdkUrl = sdkEntryUrl(sides[0]);
const full = join(sceneDerived(scene), 'native/full');
const manifestUrl = `/benchmark-assets/${scene}-derived/native/full/manifest.json`;
const { triangles: source, twoSided } = await sourceTriangles(full),
  sourceTree = buildTriangleTree(source);
const captures = new Map<string, Capture>();
const { server, port } = await startServer({ captures, mounts: resolveMounts(ROOT, sides) });

/** Runs `work` on a fresh page of a fresh Chrome, killed by its own PID afterwards. */
async function onFreshPage<T>(
  engine: string,
  work: (page: import('playwright').Page) => Promise<T>,
) {
  const browser = await launchChrome({ headless: true, args: ENGINES[engine].flags });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: DPR,
    });
    page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
    page.on(
      'console',
      (m) => m.type() === 'error' && errors.push(`console ${m.text().slice(0, 300)}`),
    );
    page.on('response', (r) => r.status() >= 400 && errors.push(`http ${r.status()} ${r.url()}`));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    return { result: await work(page), errors };
  } finally {
    await browser.close();
  }
}

const rows = [];
try {
  const poses: NamedPose[] =
    set === 'bench'
      ? benchPoses(
          (
            await onFreshPage('webgpu', (page) =>
              page.evaluate(readBounds, { sdkUrl, manifestUrl }),
            )
          ).result,
        )
      : auditPoses(set, source);
  for (const backend of backends)
    for (const pixelError of thresholds) {
      const tag = `${scene}-${backend}-e${pixelError}`;
      const options: HoldOptions = {
        sdkUrl,
        manifestUrl,
        backend: backend as HoldOptions['backend'],
        pixelError,
        width: WIDTH,
        height: HEIGHT,
        dpr: DPR,
        poses,
        tag,
      };
      const { result, errors } = await onFreshPage(backend, (page) =>
        page.evaluate(async ({ url, o }) => (await import(url)).holdAndCapture(o), {
          url: PAGE,
          o: options,
        }),
      );
      for (const [i, { view, held, canvas }] of result.entries()) {
        const ids = captures.get(`${tag}-${view}.ids`),
          tri = captures.get(`${tag}-${view}.tri`);
        const drawn = ids
          ? await pageTriangles(full, ids.body.toString('utf8').split('\n').filter(Boolean))
          : Float32Array.from(new Float64Array(new Uint8Array(tri!.body).buffer));
        const measured = measureView({
          source,
          twoSided,
          sourceTree,
          drawn,
          pose: poses[i].pose,
          width: canvas[0],
          height: canvas[1],
        });
        const worst = Math.max(measured.forward.max, measured.reverse.max);
        const row = {
          scene,
          backend,
          pixelError,
          view,
          held,
          canvas,
          ...measured,
          pass: worst <= pixelError + MARGIN_PX,
          errors,
        };
        rows.push(row);
        console.log(
          [
            scene,
            backend,
            `e${pixelError}`,
            view,
            `held@${held}`,
            `${measured.triangles} tri`,
            `fwd ${measured.forward.max.toFixed(3)}/${measured.forward.p99.toFixed(3)}`,
            `rev ${measured.reverse.max.toFixed(3)}/${measured.reverse.p99.toFixed(3)}`,
            row.pass ? 'ok' : 'KO',
            `errors ${row.errors.length}`,
          ].join('  '),
        );
      }
      captures.clear();
    }
} finally {
  await new Promise((done) => server.close(done));
}
const commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const cache = JSON.parse(readFileSync(join(full, 'manifest.json'), 'utf8')).key;
const report = { scene, poses: set, width: WIDTH, height: HEIGHT, dpr: DPR, commit, cache, rows };
writeFileSync(join(out, `${scene}.json`), JSON.stringify(report, null, 1));
