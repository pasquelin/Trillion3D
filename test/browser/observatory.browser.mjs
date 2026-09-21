import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer } from '../../scripts/mesure/serveur.mjs';
import { launchChrome } from '../../scripts/mesure/chrome.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'benchmark-runs/observatory');
await mkdir(output, { recursive: true });
const server = await startServer({
  port: 0,
  captures: new Map(),
  mounts: [
    { prefix: '/sdk/', dir: resolve(root, 'dist') },
    { prefix: '/vendor/three/', dir: resolve(root, 'node_modules/three') },
    { prefix: '/vendor/meshoptimizer/', dir: resolve(root, 'node_modules/meshoptimizer') },
    { prefix: '/site/', dir: resolve(root, 'site') },
  ],
});
const browser = await launchChrome({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 800, height: 520 },
    deviceScaleFactor: 2,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async (sdkUrl) => {
    document.body.replaceChildren();
    document.body.style.margin = '0';
    const canvas = document.createElement('canvas');
    canvas.id = 'observatory';
    canvas.style.cssText = 'width:800px;height:520px;display:block';
    document.body.append(canvas);
    const { createExplorer, webgpuPagesBackend } = await import(sdkUrl);
    window.scene = await createExplorer('observatory', {
      manifestUrl: '/site/assets/gallery/signature-architecture/cache/native/full/manifest.json',
      scope: 'full',
      importedLights: true,
      interactive: false,
      backends: [webgpuPagesBackend],
      width: 800,
      height: 520,
      pixelRatio: window.devicePixelRatio,
      temporalAntialiasing: false,
      geometryPoolBytes: 16 * 1024 * 1024,
      geometryPoolCeilingBytes: 64 * 1024 * 1024,
      texturePoolBytes: 128 * 1024 * 1024,
    });
    await window.scene.awaitPages();
    window.scene.setPose({ ...window.scene.homePose(), position: [19, 13, 22], target: [0, 3, 0] });
  }, '/sdk/sdk-browser/index.js');
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
      let restoredDifference = 0;
      if (pixelError === 0)
        for (let i = 0; i < pixels.length; i += 4)
          if (
            pixels[i] !== window.firstPixels[i] ||
            pixels[i + 1] !== window.firstPixels[i + 1] ||
            pixels[i + 2] !== window.firstPixels[i + 2]
          )
            restoredDifference++;
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
    assert.ok(sample.triangles > 0);
    assert.equal(sample.triangles, sample.selected, 'drawn triangles match the selected cut');
    assert.equal(sample.stillDifference, 0, 'a repeated still capture is identical');
    await page.screenshot({ path: resolve(output, `detail-${threshold}-${samples.length}.png`) });
    samples.push(sample);
  }
  assert.ok(samples[2].triangles < samples[1].triangles);
  assert.ok(samples[1].triangles < samples[0].triangles);
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
