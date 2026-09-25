import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer } from '../../kit/server/staticServer.ts';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { openGalleryScene, sdkMounts } from '../support/renderHarness.ts';
import { measureOutput } from '../../../bench/core/paths.ts';

// `firstPixels`/`lastPixels` only exist in the page this harness evaluates code in, never in Node;
// declared here so the `page.evaluate` callbacks below (type-checked, though they run in the
// browser) see them. `window.scene` is declared by `renderHarness.ts`.
declare global {
  interface Window {
    firstPixels?: Uint8Array;
    lastPixels?: Uint8Array;
  }
}

const root = resolve(import.meta.dirname, '../../..');
const output = measureOutput('observatory');
await mkdir(output, { recursive: true });
const { server, port } = await startServer({
  port: 0,
  captures: new Map(),
  mounts: [...sdkMounts(root), { prefix: '/site/', dir: resolve(root, 'site') }],
});
const browser = await launchChrome({ headless: true });
const errors: string[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 800, height: 520 },
    deviceScaleFactor: 2,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}`);
  await openGalleryScene(page, {
    id: 'observatory',
    width: 800,
    height: 520,
    manifestUrl: '/site/assets/gallery/signature-architecture/cache/native/full/manifest.json',
    texturePoolBytes: 128 * 1024 * 1024,
    position: [19, 13, 22],
    target: [0, 3, 0],
  });
  const samples = [];
  for (const threshold of [0, 1, 8, 0]) {
    const sample = await page.evaluate(async (pixelError) => {
      const scene = window.scene;
      scene.setPixelError(pixelError);
      let held = false,
        metrics;
      for (let frame = 0; frame < 64; frame++) {
        metrics = scene.render();
        await scene.flush();
        if (scene.backends[0].metrics().frameHeld) {
          held = true;
          break;
        }
      }
      const pixels = new Uint8Array(scene.capture());
      scene.render();
      await scene.flush();
      const repeated = new Uint8Array(scene.capture());
      let stillDifference = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (
          pixels[i] !== repeated[i] ||
          pixels[i + 1] !== repeated[i + 1] ||
          pixels[i + 2] !== repeated[i + 2]
        )
          stillDifference++;
      const previous = window.lastPixels;
      let difference = 0;
      if (previous)
        for (let i = 0; i < pixels.length; i += 4)
          if (
            pixels[i] !== previous[i] ||
            pixels[i + 1] !== previous[i + 1] ||
            pixels[i + 2] !== previous[i + 2]
          )
            difference++;
      if (!window.firstPixels) window.firstPixels = new Uint8Array(pixels);
      window.lastPixels = pixels;
      const firstPixels = window.firstPixels;
      let restoredDifference = 0;
      if (pixelError === 0)
        for (let i = 0; i < pixels.length; i += 4)
          if (
            pixels[i] !== firstPixels[i] ||
            pixels[i + 1] !== firstPixels[i + 1] ||
            pixels[i + 2] !== firstPixels[i + 2]
          )
            restoredDifference++;
      if (!metrics) throw new Error('no frame ever rendered');
      return {
        pixelError,
        held,
        triangles: metrics.drawnTriangles,
        selected: metrics.selectedTriangles,
        difference,
        restoredDifference,
        stillDifference,
        size: [scene.canvas.width, scene.canvas.height],
        backend: scene.backend,
      };
    }, threshold);
    assert.equal(sample.held, true, 'every still pose returns to held-frame rest');
    assert.equal(sample.backend, 'webgpu-page-raster');
    assert.deepEqual(sample.size, [1600, 1040], 'rendering retains CSS size times DPR');
    assert.ok((sample.triangles ?? 0) > 0);
    assert.equal(sample.triangles, sample.selected, 'drawn triangles match the selected cut');
    assert.equal(sample.stillDifference, 0, 'a repeated still capture is identical');
    await page.screenshot({ path: resolve(output, `detail-${threshold}-${samples.length}.png`) });
    samples.push(sample);
  }
  assert.ok((samples[2].triangles ?? 0) < (samples[1].triangles ?? 0));
  assert.ok((samples[1].triangles ?? 0) < (samples[0].triangles ?? 0));
  assert.ok(samples[2].difference > 0, 'the detail control changes the actual image');
  assert.equal(samples[3].triangles, samples[0].triangles);
  await page.evaluate(() => window.scene.dispose());
  assert.deepEqual(errors, []);
  const proof = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    resolution: [1600, 1040],
    dpr: 2,
    temporalAntialiasing: false,
    camera: { position: [19, 13, 22], target: [0, 3, 0] },
    geometryPoolBytes: 16 * 1024 * 1024,
    sourceTriangles: 91352,
    samples,
    errors,
    cpuFrameMs: null,
    gpuFrameMs: null,
    fps: null,
  };
  await writeFile(resolve(output, 'proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
  assert.equal(
    samples[3].restoredDifference,
    0,
    'returning to full detail restores the same image',
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
