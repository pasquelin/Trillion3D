import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportReport } from './report/export.mjs';
import { assertReport } from '../../docs/js/reports/contract.js';
import { comparison } from '../../docs/js/reports/compare.js';
import { metricValue } from '../../docs/js/reports/metrics.js';
import { canResume } from './report/provenance.mjs';
const reading = () => ({
  id: 'a',
  scene: 'scene',
  view: 'street',
  quality: 1,
  pose: { position: [1, 2, 3] },
  canvas: { width: 100, height: 100, dpr: 1 },
  pathVersion: 1,
  assetKey: 'asset',
  buildHash: 'build',
  engine: 'webgpu',
  variant: null,
  provenance: { machine: { id: 'machine' }, browser: 'Chrome 1' },
  settings: { lightShadows: true },
  gpuMethod: 'timestamp-query',
  data: { cpuFrameMs: { p50: 4 }, gpuFrameMs: { p50: 8 } },
});

test('export preserves source numbers and original pixels without inventing provenance', () => {
  const root = mkdtempSync(join(tmpdir(), 'wg-report-'));
  try {
    const source = join(root, 'source'),
      out = join(root, 'out');
    mkdirSync(join(source, 'mobile'), { recursive: true });
    const raw = {
      scene: 'scene',
      head: 'abc',
      finishedAt: '2026-09-20T00:00:00Z',
      errors: [],
      settings: {},
      series: [
        {
          view: 'street',
          pixelError: 1,
          sides: {
            apres: { cpuFrameMs: { p50: 0, p95: 2 }, imageSyncMs: { p50: 9 }, png: 'a.png' },
            'apres-aa': { cpuFrameMs: { p50: 99 } },
          },
        },
      ],
    };
    writeFileSync(join(source, 'mobile/mesure.json'), JSON.stringify(raw));
    writeFileSync(join(source, 'mobile/a.png'), 'original-pixels');
    const report = exportReport(source, out, 'campaign');
    assert.equal(report.records.length, 1);
    const r = report.records[0];
    assert.equal(metricValue(r, 'cpu'), 0);
    assert.equal(metricValue(r, 'gpu'), null);
    assert.equal(metricValue(r, 'sync'), 9);
    assert.equal(r.provenance, null);
    assert.equal(readFileSync(join(out, r.image), 'utf8'), 'original-pixels');
    assert.throws(() => exportReport(source, out, 'campaign'), /already exists/);
    assert.throws(() => assertReport({ ...report, formatVersion: 2 }), /Unsupported/);
    assert.throws(
      () => assertReport({ ...report, records: [{ ...r, image: '../secret' }] }),
      /image path/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('comparison admits only its declared variable and separates GPU and synchronized clocks', () => {
  const a = reading(),
    b = { ...reading(), id: 'b', data: { cpuFrameMs: { p50: 3 } } };
  assert.deepEqual(comparison(a, b, 'cpu'), {
    status: 'descriptive',
    reasons: [],
    delta: -1,
    percent: -25,
  });
  assert.equal(comparison(a, b, 'cpu', 'frames').status, 'incompatible');
  assert.equal(comparison(a, { ...b, provenance: null }, 'cpu').status, 'incompatible');
  assert.equal(comparison(a, { ...b, settings: { lightShadows: false } }, 'cpu').delta, null);
  assert.equal(
    comparison(a, { ...b, settings: { lightShadows: false } }, 'cpu', 'lightShadows').delta,
    -1,
  );
  assert.equal(comparison(a, { ...b, data: { imageSyncMs: { p50: 3 } } }, 'gpu').delta, null);
  assert.equal(comparison(a, { ...b, buildHash: 'other' }, 'cpu').delta, null);
  assert.equal(comparison(a, { ...b, buildHash: 'other' }, 'cpu', 'version').delta, -1);
  assert.equal(comparison({ ...a, data: { cpuFrameMs: { p50: 0 } } }, b, 'cpu').percent, null);
});

test('resume requires identical campaign identity and completed error-free measurements', () => {
  const raw = { campaignIdentity: 'a', finishedAt: 'date', series: [{}], errors: [] };
  assert.equal(canResume(raw, 'a'), true);
  for (const changed of [
    { campaignIdentity: 'b' },
    { finishedAt: null },
    { series: [] },
    { errors: ['failed'] },
  ])
    assert.equal(canResume({ ...raw, ...changed }, 'a'), false);
});
