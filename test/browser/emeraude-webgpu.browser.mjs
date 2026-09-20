import { emeraldProvenance, MEASURE_WIDTH, MEASURE_HEIGHT } from '../appui/emeraldProvenance.mjs';
import { routeBaseline } from '../appui/emeraldBaseline.mjs';
import assert from 'node:assert/strict';
import { launchChrome } from '../../scripts/mesure/chrome.mjs';
import { startServer } from '../../scripts/mesure/serveur.mjs';
import { resolveMounts } from '../../scripts/mesure/options.mjs';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const ROOT = resolve(import.meta.dirname, '../..');
const run = process.argv[2] ?? new Date().toISOString().replaceAll(':', '-');
const out = resolve('benchmark-runs/webgpu-visual', run);
// The harness page and its import map, the trajectory under `/mesure/`, and the engine this run
// proves — `routeBaseline` intercepts `/dist/sdk-browser/`, so the engine keeps that prefix.
const mounts = [...resolveMounts(ROOT, []), { prefix: '/dist/', dir: resolve(ROOT, 'dist') }];
const server = await startServer({ port: 0, mounts, captures: new Map() });
const harnessUrl = `http://127.0.0.1:${server.address().port}`;
const provenance = await emeraldProvenance(harnessUrl),
  taa = process.env.WEBGPU_TAA !== 'off';
await mkdir(out, { recursive: true });
const browser = await launchChrome({ headless: true });
try {
  // The window holds the measurement resolution, whether the canvas is sized explicitly or not.
  const viewport = { width: MEASURE_WIDTH, height: MEASURE_HEIGHT };
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(m.text());
  });
  if (process.env.WEBGPU_BASELINE_DIR)
    await routeBaseline(page, out, provenance, process.env.WEBGPU_BASELINE_DIR);
  await page.goto(harnessUrl + '/');
  await page.exposeFunction('saveImage', async (name, data) => {
    await writeFile(out + '/' + name + '.png', Buffer.from(data.split(',')[1], 'base64'));
    console.log('captured', name);
  });
  const result = await page.evaluate(
    async ({ sdkUrl, temporalAntialiasing, ...viewport }) => {
      const { createExplorer, referenceBackend, webgpuPagesBackend } = await import(sdkUrl);
      const { poseAt, PATH_POSES, FRAMES_PER_SEGMENT } = await import('/mesure/poses.mjs');
      const backends = {
        'three-webgl-reference': referenceBackend,
        'webgpu-page-raster': webgpuPagesBackend,
      };
      const results = [],
        images = [],
        events = [];
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw Error('No WebGPU adapter');
      const gpu = {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        device: adapter.info.device,
        description: adapter.info.description,
      };
      const read = (canvas) => {
        const gl = canvas.getContext('webgl2'),
          p = new Uint8Array(canvas.width * canvas.height * 4);
        if (gl) {
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, p);
          return p;
        }
        const probe = document.createElement('canvas');
        probe.width = canvas.width;
        probe.height = canvas.height;
        const ctx = probe.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(canvas, 0, 0);
        const top = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let y = 0; y < canvas.height; y++)
          p.set(
            top.subarray(y * canvas.width * 4, (y + 1) * canvas.width * 4),
            (canvas.height - 1 - y) * canvas.width * 4,
          );
        return p;
      };
      for (const id of ['three-webgl-reference', 'webgpu-page-raster']) {
        const canvas = document.createElement('canvas');
        document.body.append(canvas);
        const e = await createExplorer(canvas, {
          manifestUrl: '/benchmark-assets/emerald-square-derived/native/full/manifest.json',
          scope: 'full',
          ...viewport,
          pixelError: 1,
          maxResidentPages: 100000,
          preload: 'visible',
          backends: [backends[id]],
          textureSource: id === 'webgpu-page-raster' ? 'cache' : 'host', // the witness keeps its images
          temporalAntialiasing,
          clearColor: 0x2a303c,
          onDiagnostic: (event) => events.push({ id, ...event }),
        });
        e.select(id);
        // One pose per trajectory point: the first frame of each segment.
        for (let i = 0; i * FRAMES_PER_SEGMENT < PATH_POSES; i++) {
          const pose = poseAt(e.bounds, i * FRAMES_PER_SEGMENT);
          e.setPose(pose);
          await e.awaitPages();
          // Warmup: an engine that publishes `frameHeld` renders until the held image — a full
          // cycle of still frames after the last texture arrival, 64 at most: at 24, eight poses
          // in ten were recorded before convergence — the witness four frames as always.
          let metrics = { ...e.render() };
          for (let w = 1; w < ('frameHeld' in metrics ? 64 : 4) && !metrics.frameHeld; w++) {
            await e.flush();
            metrics = { ...e.render() };
          }
          await e.flush();
          metrics = { ...e.render() };
          const pixels = read(canvas);
          await window.saveImage(id + '-' + i, canvas.toDataURL());
          const capture = e.capture();
          let captureMax = 0,
            captureDiff = 0;
          for (let p = 0; p < pixels.length; p++) {
            let d = Math.abs(pixels[p] - capture[p]);
            captureMax = Math.max(d, captureMax);
            if (d > 2) captureDiff++;
          }
          let diff = null;
          if (id === 'three-webgl-reference') images.push(pixels);
          else {
            const ref = images[i];
            let sum = 0,
              max = 0,
              count = 0,
              fgCount = 0,
              fgSum = 0;
            for (let p = 0; p < ref.length; p += 4) {
              let changed = false;
              const fg = ref[p] !== 42 || ref[p + 1] !== 48 || ref[p + 2] !== 60;
              for (let c = 0; c < 3; c++) {
                const d = Math.abs(ref[p + c] - pixels[p + c]);
                sum += d;
                max = Math.max(max, d);
                if (d > 2) changed = true;
                if (fg) fgSum += d;
              }
              if (fg) fgCount++;
              if (changed) count++;
            }
            diff = {
              mae: sum / ((ref.length / 4) * 3),
              max,
              differentPixels: count,
              foregroundMae: fgSum / (fgCount * 3),
              foregroundPixels: fgCount,
            };
          }
          results.push({
            id,
            segment: i,
            pose,
            sourceKey: e.metadata.key,
            metrics,
            captureMax,
            captureDiff,
            diff,
          });
        }
        e.dispose();
        canvas.remove();
      }
      return { results, events, gpu, userAgent: navigator.userAgent };
    },
    // `WEBGPU_TAA=off` yields the `--avant` of the Lumiere 16 batch, with no jitter and no history.
    { sdkUrl: '/dist/sdk-browser/index.js', temporalAntialiasing: taa, ...viewport },
  );
  result.provenance = provenance;
  result.errors = errors;
  await writeFile(out + '/result.json', JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      result.results.map((x) => ({
        id: x.id,
        segment: x.segment,
        captureMax: x.captureMax,
        diff: x.diff,
      })),
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  assert.equal(result.results.length, 20);
  assert.ok(
    !result.events.some((event) => /failed|uncaptured-error/.test(event.phase)),
    'render diagnostic failure: inspect result.json',
  );
  if (!process.env.WEBGPU_BASELINE_DIR)
    assert.ok(
      result.events.some(
        (event) => event.phase === 'render-capabilities' && event.context.visibilityBuffer,
      ),
      'real visibility buffer required',
    );
} finally {
  await browser.close();
  server.close();
}
