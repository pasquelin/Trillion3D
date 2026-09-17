import { emeraldProvenance } from '../appui/emeraldProvenance.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const labRoot = process.env.LAB_ROOT ?? resolve('../render-tech-lab');
const { chromium } = createRequire(resolve(labRoot, 'package.json'))('playwright');
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const out = resolve(
  'benchmark-runs/webgpu-visual',
  process.argv[2] ?? new Date().toISOString().replaceAll(':', '-'),
);
const provenance = await emeraldProvenance(labRoot);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(m.text());
  });
  if (process.env.WEBGPU_BASELINE_DIR) {
    const ts = (await import('typescript')).default;
    for (const file of ['webgpuPages', 'visibilityBuffer']) {
      const source = await readFile(resolve(process.env.WEBGPU_BASELINE_DIR, file + '.ts'), 'utf8');
      provenance.baselineOverrides.push({
        file,
        sha256: createHash('sha256').update(source).digest('hex'),
      });
      await writeFile(resolve(out, file + '.baseline.ts'), source);
      const js = ts
        .transpileModule(source, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        })
        .outputText.replaceAll(".ts'", ".js'")
        .replaceAll("from 'three'", "from '/.vite/deps/three.js'");
      await page.route('**/dist/sdk-browser/' + file + '.js*', (route) =>
        route.fulfill({ contentType: 'application/javascript', body: js }),
      );
    }
  }
  await page.goto(provenance.labUrl + '/?test=15-virtualized-integration');
  await page.exposeFunction('saveImage', async (name, data) => {
    await writeFile(out + '/' + name + '.png', Buffer.from(data.split(',')[1], 'base64'));
    console.log('captured', name);
  });
  const result = await page.evaluate(
    async (sdkUrl) => {
      const { benchEngine } = await import('/15-virtualized-integration/implementation/engines.ts');
      const { createExplorer } = await import(sdkUrl);
      const { urbanPath, framesPerSegment } = await import('/src/lab/modelCampaign.ts');
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
          width: 1012,
          height: 1000,
          pixelError: 1,
          maxResidentPages: 100000,
          preload: 'visible',
          backends: [benchEngine(id).factory],
          clearColor: 0x2a303c,
          onDiagnostic: (event) => events.push({ id, ...event }),
        });
        e.select(id);
        const path = urbanPath(e.bounds).filter((s, i) => i % framesPerSegment === 0);
        for (const [i, s] of path.entries()) {
          e.setPose(s.pose);
          await e.awaitPages();
          for (let w = 0; w < 4; w++) {
            e.render();
            await e.flush();
          }
          const metrics = { ...e.render() };
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
            pose: s.pose,
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
    '/@fs' + resolve('dist/sdk-browser/index.js'),
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
}
