// Run against the real banc 15 server after building the SDK. A variant can be
// recorded separately in the same output directory with COARSE_LOD_VARIANTS.
// Example: COARSE_LOD_VARIANTS=reference,before node test/coarseLodEmerald.browser.mjs <output-dir>
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve, relative} from 'node:path';
import {gzipSync, gunzipSync} from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const labRoot = resolve(process.env.LAB_ROOT ?? resolve(root, '../render-tech-lab'));
const labUrl = process.env.LAB_URL ?? 'http://localhost:5174';
const out = resolve(process.argv[2] ?? resolve(root, 'benchmark-runs/coarse-lod/visual'));
const runtimeRoot = resolve(process.env.COARSE_LOD_RUNTIME_DIR ?? resolve(root, 'benchmark-runs/coarse-lod/runtime-fixed'));
const {chromium} = createRequire(resolve(labRoot, 'package.json'))('playwright');
const variantOption = process.env.COARSE_LOD_VARIANTS ?? 'reference,before,after';
const selectedVariants = variantOption === 'compare' ? [] : variantOption.split(',');
assert.ok(selectedVariants.every(v => ['reference', 'before', 'after'].includes(v)));
assert.equal(new Set(selectedVariants).size, selectedVariants.length);
const manifests = {
  before: new URL(process.env.BEFORE_MANIFEST_URL ?? '/@fs' + resolve(root, 'benchmark-runs/coarse-lod/cache-before/native/full/manifest.json'), labUrl).href,
  after: new URL(process.env.AFTER_MANIFEST_URL ?? '/@fs' + resolve(root, 'benchmark-runs/coarse-lod/cache-after/native/full/manifest.json'), labUrl).href,
};
const protocol = {
  width: 1012, height: 1000, pixelRatio: 1, pixelError: 1,
  maxResidentPages: 100000, maxCachedPages: 100000, pageFetchWorkers: 8,
  maxPageTransferBytes: 256 * 1024 * 1024,
  clearColor: 0x2a303c, warmupFrames: 4, measuredFrames: 12,
  exactControlSegments: [0, 4], distantScales: [4, 16],
  scope: 'full', preload: 'visible', lodAdaptive: false,
  timingScope: 'CPU host render only; no GPU completion or FPS claim',
  order: 'reference, before, after; no randomized performance campaign',
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Vite may observe another SDK build while the long campaign is running. Keep
// a verified, reusable copy so every explorer imports identical renderer code.
let runtime;
try { runtime = JSON.parse(await readFile(resolve(runtimeRoot, 'runtime-manifest.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!runtime) {
  const modules = new Map();
  for (const folder of ['dist/sdk-browser', 'dist/sdk-core']) {
    for (const entry of await readdir(resolve(root, folder), {withFileTypes: true})) {
      if (entry.isFile() && entry.name.endsWith('.js')) {
        const file = folder + '/' + entry.name;
        modules.set(file, await readFile(resolve(root, file)));
      }
    }
  }
  assert.ok(modules.has('dist/sdk-browser/index.js'));
  for (const [file, bytes] of modules) assert.equal(hash(await readFile(resolve(root, file))), hash(bytes), `SDK changed during snapshot: ${file}; retry after its build finishes`);
  const hashes = {};
  for (const [file, bytes] of modules) {
    await mkdir(resolve(runtimeRoot, file, '..'), {recursive: true});
    await writeFile(resolve(runtimeRoot, file), bytes);
    hashes[file] = hash(bytes);
  }
  await writeFile(resolve(runtimeRoot, 'package.json'), JSON.stringify({name: 'emerald-fixed-runtime', private: true, type: 'module', dependencies: {three: '^0.174.0'}}));
  runtime = {root: runtimeRoot, capturedAt: new Date().toISOString(), hashes, sha256: hash(JSON.stringify(hashes))};
  await writeFile(resolve(runtimeRoot, 'runtime-manifest.json'), JSON.stringify(runtime, null, 2));
}
for (const [file, expected] of Object.entries(runtime.hashes)) assert.equal(hash(await readFile(resolve(runtimeRoot, file))), expected, `Frozen runtime changed: ${file}`);
const sourceHashes = {};
for (const folder of ['packages/sdk-browser', 'packages/sdk-core', 'dist/sdk-browser', 'dist/sdk-core']) {
  for (const entry of await readdir(resolve(root, folder), {withFileTypes: true})) {
    if (!entry.isFile() || !/\.(?:ts|js)$/.test(entry.name) || /\.test\.|\.d\.ts$/.test(entry.name)) continue;
    const path = resolve(root, folder, entry.name);
    sourceHashes[relative(root, path)] = hash(await readFile(path));
  }
}
for (const path of ['15-virtualized-integration/implementation/engines.ts', 'src/lab/modelCampaign.ts']) {
  sourceHashes['lab/' + path] = hash(await readFile(resolve(labRoot, path)));
}
const provenance = {
  startedAt: new Date().toISOString(), labRoot, labUrl, root,
  head: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  workingTree: execFileSync('git', ['status', '--short'], {cwd: root, encoding: 'utf8'}).trim(),
  sourceHashes, runtime, protocol, manifests, variants: selectedVariants, outcomes: {},
};
await mkdir(out, {recursive: true});
let prior = null;
try { prior = JSON.parse(await readFile(resolve(out, 'result.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (prior) assert.deepEqual(prior.protocol, protocol, 'Output directory contains another protocol');
const result = prior ?? {version: 1, protocol, runs: [], variants: {}, comparisons: []};
result.runs.push(provenance);
const saveResult = () => writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
await saveResult();

const cacheDirectories = [...new Set(Object.values(manifests))].flatMap(manifestUrl => {
  const base = new URL('.', manifestUrl);
  return base.origin === new URL(labUrl).origin && base.pathname.startsWith('/@fs/')
    // Content-addressed pages live in native/objects, beside native/full.
    ? [{url: base.href, directory: resolve(decodeURIComponent(base.pathname.slice('/@fs'.length)), '..')}] : [];
});
// Stream the 195 MB source buffer through HTTP instead of serializing it as
// a single DevTools route.fulfill payload, which can close Chrome's pipe.
const assetServer = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Private-Network', 'true');
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const labAssets = resolve(labRoot, 'public/benchmark-assets');
  const path = pathname.startsWith('/@fs/') ? resolve(pathname.slice('/@fs'.length))
    : pathname.startsWith('/benchmark-assets/') ? resolve(labRoot, 'public', '.' + pathname) : '';
  if (!cacheDirectories.some(({directory}) => path.startsWith(directory + '/')) && !path.startsWith(labAssets + '/')) {
    response.writeHead(404); response.end(); return;
  }
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  response.setHeader('Content-Type', /\.(?:json|gltf)$/.test(path) ? 'application/json' : /\.png$/.test(path) ? 'image/png' : /\.jpe?g$/.test(path) ? 'image/jpeg' : 'application/octet-stream');
  const stream = createReadStream(path);
  stream.on('error', () => { if (!response.headersSent) response.writeHead(404); response.end(); });
  stream.pipe(response);
});
if (selectedVariants.length) await new Promise(resolve => assetServer.listen(0, '127.0.0.1', resolve));
const assetOrigin = selectedVariants.length ? `http://localhost:${assetServer.address().port}` : null;
const servedManifest = manifestUrl => cacheDirectories.some(({url}) => manifestUrl.startsWith(url))
  ? assetOrigin + new URL(manifestUrl).pathname : manifestUrl;
let browser;
try {
  if (selectedVariants.length) browser = await chromium.launch({channel: 'chrome', headless: true});
  for (const variant of selectedVariants) {
    const page = await browser.newPage({viewport: {width: 1400, height: 1200}});
    const errors = [], consoleErrors = [], requestFailures = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('requestfailed', request => requestFailures.push({url: request.url(), error: request.failure()?.errorText}));
    const images = new Map();
    await page.route(new URL('/__coarse_lod_runtime__/**', labUrl).href, async route => {
      const file = decodeURIComponent(new URL(route.request().url()).pathname).slice('/__coarse_lod_runtime__/'.length);
      assert.ok(Object.hasOwn(runtime.hashes, file), `Unknown frozen runtime module: ${file}`);
      await route.fulfill({contentType: 'application/javascript', path: resolve(runtimeRoot, file)});
    });
    await page.exposeFunction('saveCoarseLodCapture', async (name, pngDataUrl, rgbaBase64) => {
      const png = Buffer.from(pngDataUrl.split(',')[1], 'base64');
      const pixels = Buffer.from(rgbaBase64, 'base64');
      assert.equal(pixels.length, protocol.width * protocol.height * 4);
      await writeFile(resolve(out, name + '.png'), png);
      await writeFile(resolve(out, name + '.rgba.gz'), gzipSync(pixels));
      const capture = {png: name + '.png', pixels: name + '.rgba.gz', pngSha256: hash(png), pixelSha256: hash(pixels)};
      images.set(name, capture);
      console.log(`captured ${name}`);
      return capture;
    });
    // The host belongs to the live lab origin; only its UI is omitted so an
    // unrelated animation loop cannot contend with the measured renderer.
    const host = new URL('/package.json', labUrl).href;
    const imports = {
      three: '/.vite/deps/three.js', meshoptimizer: '/.vite/deps/meshoptimizer.js',
      'three/addons/controls/FlyControls.js': '/.vite/deps/three_addons_controls_FlyControls__js.js',
      'three/addons/controls/OrbitControls.js': '/.vite/deps/three_addons_controls_OrbitControls__js.js',
      'three/addons/loaders/GLTFLoader.js': '/.vite/deps/three_addons_loaders_GLTFLoader__js.js',
    };
    await page.goto(host);
    await page.setContent(`<!doctype html><title>Emerald coarse LOD banc 15</title><script type="importmap">${JSON.stringify({imports})}</script><body></body>`);
    console.log(`starting ${variant}`);
    let record;
    try {
      record = await page.evaluate(async ({variant, manifestUrl, sdkUrl, protocol}) => {
        // These are the same public factories used by banc 15, imported from
        // the frozen distribution rather than Vite's mutable package alias.
        const {createExplorer, referenceBackend, exactPagesBackend} = await import(sdkUrl);
        const {urbanPath, framesPerSegment, pathVersion, segmentNames} = await import('/src/lab/modelCampaign.ts');
        const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
        const fetchArtifact = async url => {
          const response = await fetch(url);
          if (!response.ok) throw Error(`HTTP ${response.status}: ${url}`);
          const bytes = await response.arrayBuffer();
          return {url, bytes: bytes.byteLength, sha256: await digest(bytes), json: JSON.parse(new TextDecoder().decode(bytes))};
        };
        const manifest = await fetchArtifact(manifestUrl);
        const metadata = await fetchArtifact(new URL(manifest.json.url, manifestUrl).href);
        const source = await fetchArtifact(new URL('source.gltf', metadata.url).href);
        const artifacts = [manifest, metadata, source].map(({json, ...artifact}) => artifact);
        const backend = variant === 'reference' ? 'three-webgl-reference' : 'exact-cluster-pages';
        const events = [];
        const canvas = document.createElement('canvas');
        document.body.append(canvas);
        const explorer = await createExplorer(canvas, {
          manifestUrl, scope: protocol.scope,
          width: protocol.width, height: protocol.height, pixelRatio: protocol.pixelRatio,
          pixelError: protocol.pixelError, lodAdaptive: protocol.lodAdaptive,
          maxResidentPages: protocol.maxResidentPages,
          maxCachedPages: protocol.maxCachedPages, pageFetchWorkers: protocol.pageFetchWorkers,
          maxPageTransferBytes: protocol.maxPageTransferBytes,
          preload: protocol.preload, clearColor: protocol.clearColor,
          backends: [variant === 'reference' ? referenceBackend : exactPagesBackend], diagnosticDetail: 'summary',
          onDiagnostic(event) {
            const {pageCatalogue, ...context} = event.context ?? {};
            events.push({...event, context: {...context, ...(pageCatalogue ? {pageCatalogueCount: pageCatalogue.length} : {})}});
          },
        });
        explorer.select(backend);
        const gl = canvas.getContext('webgl2');
        if (!gl) throw Error('WebGL2 context unavailable');
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        const hardware = {
          userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
          renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
          vendor: gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
          version: gl.getParameter(gl.VERSION), browserDeviceMemoryGiB: navigator.deviceMemory ?? null,
        };
        const checkpoints = urbanPath(explorer.bounds).filter((_, i) => i % framesPerSegment === 0);
        const generalPose = checkpoints[0].pose;
        for (const scale of protocol.distantScales) {
          checkpoints.push({
            segment: checkpoints.length, name: `General view distance multiplied by ${scale}`,
            pose: {
              ...generalPose, target: [...generalPose.target],
              position: generalPose.position.map((value, i) => generalPose.target[i] + (value - generalPose.target[i]) * scale),
              far: generalPose.far * scale,
            },
          });
        }
        const samples = [], captures = [];
        const preparationMs = explorer.preparationMs;
        const encode = bytes => {
          let binary = '';
          for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
          return btoa(binary);
        };
        const aaDifference = (a, b) => {
          let differentPixels = 0, maxChannelError = 0;
          for (let p = 0; p < a.length; p += 4) {
            let changed = false;
            for (let c = 0; c < 4; c++) {
              const d = Math.abs(a[p + c] - b[p + c]);
              maxChannelError = Math.max(maxChannelError, d);
              if (d) changed = true;
            }
            if (changed) differentPixels++;
          }
          return {differentPixels, maxChannelError};
        };
        const capture = async (step, pixelError) => {
          explorer.setPixelError(pixelError);
          explorer.setPose(step.pose);
          // awaitPages resolves one requested cut. Repeating until pendingUrls
          // empties prevents recording a fallback while another LOD is loading.
          const settleStart = performance.now();
          let settlementPasses = 0;
          for (; settlementPasses < 16; settlementPasses++) {
            await explorer.awaitPages();
            explorer.render();
            await explorer.flush();
            if (!explorer.backends.some(b => (b.pendingUrls?.().length ?? 0) > 0)) break;
          }
          if (settlementPasses === 16) throw Error('Visible pages did not settle');
          const settlementMs = performance.now() - settleStart;
          for (let i = 0; i < protocol.warmupFrames; i++) { explorer.render(); await explorer.flush(); }
          const frames = [];
          for (let i = 0; i < protocol.measuredFrames; i++) {
            await new Promise(requestAnimationFrame);
            frames.push({...explorer.render()});
            await explorer.flush();
          }
          if (explorer.fallbackReason) throw Error(`Backend fallback: ${explorer.fallbackReason}`);
          // capture performs its own draw/readPixels synchronously; pixels and
          // PNG therefore refer to the same visible default framebuffer.
          const pixels = new Uint8Array(explorer.capture());
          const png = canvas.toDataURL('image/png');
          explorer.render();
          await explorer.flush();
          const repeat = explorer.capture();
          const aa = aaDifference(pixels, repeat);
          const name = `${variant}-p${pixelError}-segment${step.segment}`;
          const artifact = await window.saveCoarseLodCapture(name, png, encode(pixels));
          captures.push({segment: step.segment, name: step.name ?? segmentNames[step.segment], pixelError, pose: step.pose, aa, ...artifact});
          samples.push({segment: step.segment, pixelError, pose: step.pose, settlementMs, settlementPasses: settlementPasses + 1, frames});
        };
        try {
          for (const checkpoint of checkpoints) await capture(checkpoint, protocol.pixelError);
          if (variant !== 'reference') for (const segment of protocol.exactControlSegments) await capture(checkpoints[segment], 0);
          return {
            variant, backend, manifestUrl, pathVersion, hardware, artifacts, preparationMs,
            sourceKey: explorer.metadata.key,
            sourceTriangles: explorer.metadata.sourceTriangles,
            selectedSourceTriangles: explorer.metadata.selectedTriangles,
            errorModel: explorer.metadata.errorModel,
            compilerVersion: explorer.metadata.compilerVersion,
            bounds: {min: explorer.bounds.min.toArray(), max: explorer.bounds.max.toArray()},
            samples, captures, events,
          };
        } finally { explorer.dispose(); canvas.remove(); }
      }, {
        variant, manifestUrl: servedManifest(manifests[variant === 'after' ? 'after' : 'before']),
        sdkUrl: '/__coarse_lod_runtime__/dist/sdk-browser/index.js', protocol,
      });
    } catch (error) {
      result.variants[variant] = {variant, status: 'failed', error: String(error), errors, consoleErrors, requestFailures, provenanceRun: result.runs.length - 1, captures: [...images.values()]};
      provenance.outcomes[variant] = {...result.variants[variant]};
      await saveResult();
      throw error;
    } finally { await page.close(); }
    record.errors = errors;
    record.consoleErrors = consoleErrors;
    record.requestFailures = requestFailures;
    record.provenanceRun = result.runs.length - 1;
    record.status = errors.length || requestFailures.length ? 'failed' : 'completed';
    result.variants[variant] = record;
    provenance.outcomes[variant] = {status: record.status, captures: record.captures.length, errors, consoleErrors, requestFailures};
    await saveResult();
    assert.deepEqual(errors, [], 'Page errors; inspect result.json');
    assert.deepEqual(requestFailures, [], 'Failed requests; inspect result.json');
    assert.equal(record.captures.length, 10 + protocol.distantScales.length + (variant === 'reference' ? 0 : protocol.exactControlSegments.length));
    assert.ok(!record.events.some(event => /failed|uncaptured-error|backend-preparation-error/.test(event.phase)), 'Render diagnostic failure; inspect result.json');
  }
} finally {
  await browser?.close();
  if (selectedVariants.length) await new Promise(resolve => assetServer.close(resolve));
}

const comparePixels = (a, b) => {
  assert.equal(a.length, b.length);
  let sum = 0, maxChannelError = 0, differentPixels = 0, differentPixelsOver2 = 0, foregroundPixels = 0, foregroundSum = 0, lostForegroundPixels = 0, gainedForegroundPixels = 0;
  for (let p = 0; p < a.length; p += 4) {
    let changed = false, changedOver2 = false;
    const foreground = a[p] !== 42 || a[p + 1] !== 48 || a[p + 2] !== 60;
    const otherForeground = b[p] !== 42 || b[p + 1] !== 48 || b[p + 2] !== 60;
    if (foreground && !otherForeground) lostForegroundPixels++;
    if (!foreground && otherForeground) gainedForegroundPixels++;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[p + c] - b[p + c]);
      sum += d;
      maxChannelError = Math.max(maxChannelError, d);
      if (d) changed = true;
      if (d > 2) changedOver2 = true;
      if (foreground) foregroundSum += d;
    }
    if (changed) differentPixels++;
    if (changedOver2) differentPixelsOver2++;
    if (foreground) foregroundPixels++;
  }
  return {
    mae: sum / (a.length / 4 * 3), maxChannelError, differentPixels, differentPixelsOver2,
    differentPixelFraction: differentPixels / (a.length / 4), foregroundPixels,
    lostForegroundPixels, gainedForegroundPixels,
    foregroundMae: foregroundPixels ? foregroundSum / (foregroundPixels * 3) : null,
  };
};
result.comparisons = [];
for (const [leftName, rightName] of [['reference', 'before'], ['reference', 'after'], ['before', 'after']]) {
  const left = result.variants[leftName], right = result.variants[rightName];
  if (left?.status !== 'completed' || right?.status !== 'completed') continue;
  assert.equal(left.pathVersion, right.pathVersion);
  assert.deepEqual(left.bounds, right.bounds);
  const leftRun = result.runs[left.provenanceRun], rightRun = result.runs[right.provenanceRun];
  const runtimeChangedFiles = Object.keys(leftRun.runtime.hashes).filter(file => leftRun.runtime.hashes[file] !== rightRun.runtime.hashes[file]);
  for (const b of right.captures) {
    const a = left.captures.find(c => c.segment === b.segment && (leftName === 'reference' || c.pixelError === b.pixelError));
    if (!a) continue;
    assert.deepEqual(a.pose, b.pose);
    const aPixels = gunzipSync(await readFile(resolve(out, a.pixels)));
    const bPixels = gunzipSync(await readFile(resolve(out, b.pixels)));
    result.comparisons.push({
      left: leftName, right: rightName, segment: b.segment, pixelError: b.pixelError,
      ...comparePixels(aPixels, bPixels),
      aaStable: a.aa.differentPixels === 0 && b.aa.differentPixels === 0,
      sameHardware: JSON.stringify(left.hardware) === JSON.stringify(right.hardware), runtimeChangedFiles,
      sameSourceGltf: left.artifacts[2].sha256 === right.artifacts[2].sha256,
      sameSourceTriangleCount: left.sourceTriangles === right.sourceTriangles,
    });
  }
}
const summarize = values => {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  return sorted.length ? {count: sorted.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1)} : null;
};
result.summary = Object.fromEntries(Object.entries(result.variants).map(([variant, record]) => [variant, record.status !== 'completed' ? {status: record.status} : {
  status: record.status, sourceTriangles: record.sourceTriangles,
  aaStable: record.captures.every(capture => capture.aa.differentPixels === 0),
  poses: record.samples.filter(sample => sample.pixelError === protocol.pixelError).map(sample => ({
    segment: sample.segment,
    cpuFrameMs: summarize(sample.frames.map(frame => frame.cpuFrameMs)),
    selectedTriangles: summarize(sample.frames.map(frame => frame.selectedTriangles)),
    submittedTriangles: summarize(sample.frames.map(frame => frame.submittedTriangles)),
    residentPages: summarize(sample.frames.map(frame => frame.residentPages)),
    drawCalls: summarize(sample.frames.map(frame => frame.drawCalls)),
  })),
}]));
result.finishedAt = new Date().toISOString();
await saveResult();
console.log(JSON.stringify({output: out, variants: Object.keys(result.variants), comparisons: result.comparisons.length, aaStable: Object.fromEntries(Object.entries(result.summary).map(([name, data]) => [name, data.aaStable]))}, null, 2));
