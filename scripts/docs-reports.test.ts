import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseRoute, routeHref, resolvePage } from '../site/app/portal/routes.ts';
import { runName, viewName } from '../site/reports/names.ts';
import { flattenFields } from '../site/reports/availability.ts';
import { pairedImages } from '../site/reports/presentation.ts';
import { readingGroups } from '../site/reports/sources.ts';
import { metricValue } from '../site/reports/metrics.ts';
import { baseRecord, baseRun, baseReport } from './docs/report-fixtures.ts';
import {
  Comparison,
  Evidence,
  AllReadings,
  BarChart,
  Findings,
  SceneNotice,
} from './docs/report-components.ts';

test('report routes resolve in each language; names are its words, an unknown id kept', () => {
  for (const locale of ['en', 'fr'] as const) {
    const route = parseRoute(routeHref({ locale, area: 'reports', id: 'september-18' }));
    assert.equal(route.id, 'september-18');
    assert.equal(resolvePage(route, []).kind, 'report');
  }
  assert.deepEqual(
    [viewName('sol', 'fr'), viewName('elsewhere', 'fr'), runName('res-1248-e2', 'en')],
    ['Au sol', 'elsewhere', 'Image width 1248 px · threshold 2 px'],
  );
  assert.equal(runName('lampes-8-sans-ombres', 'fr'), '8 lumières sans ombres');
});

test('comparison names engines, explains missing values and shows observed arithmetic', () => {
  const a = {
    ...baseRecord,
    id: 'a',
    engine: 'three-nu',
    data: { cpuFrameMs: { p50: 4, p95: 4 } },
  };
  const b = {
    ...baseRecord,
    id: 'b',
    engine: 'webgpu-page-raster',
    data: { cpuFrameMs: { p50: 1, p95: 1 } },
  };
  for (const locale of ['en', 'fr'] as const) {
    const html = renderToStaticMarkup(
      createElement(Comparison, { locale, a, b, variable: 'engine' }),
    );
    assert.match(html, /Three.js/);
    assert.match(html, /Trillion3D/);
    assert.match(html, /-3 ms/);
    assert.doesNotMatch(html, /<details|<select|NaN|Infinity|undefined|>A<|>B</);
  }
});

test('image pairing never combines different measured frames', () => {
  const a = {
    ...baseRecord,
    id: 'a',
    engine: 'three-nu',
    image: 'a.png',
    differencePair: 'pair',
  };
  const b = { ...a, id: 'b', engine: 'webgpu-page-raster', image: 'b.png' };
  assert.deepEqual(pairedImages([a, b, { ...b, id: 'c', differencePair: 'other' }]), [[a, b]]);
  const html = renderToStaticMarkup(
    createElement(Evidence, { a, b, campaign: 'test', locale: 'fr' }),
  );
  assert.doesNotMatch(html, /type="range"/);
  assert.match(html, /diff-resizer/);
  assert.match(html, /Glisser pour comparer/);
  assert.match(html, /reports\/test\/a.png/);
  assert.match(html, /reports\/test\/b.png/);
});

test('complete tables preserve every source leaf, repeats, zero, null and recorded texture budget', () => {
  const raw = {
    frames: 0,
    series: [{ sides: { after: { gpu: null }, 'after-aa': { gpu: 2.75 } } }],
    errors: [],
  };
  assert.deepEqual(
    [...flattenFields(raw)],
    [
      ['frames', 0],
      ['series.0.sides.after.gpu', null],
      ['series.0.sides.after-aa.gpu', 2.75],
      ['errors', '[]'],
    ],
  );
  // `metricValue` reads dotted paths dynamically (`readPath`), including ones like
  // `metrics.textureBudgetBytes` that `ReportRecordData` does not model statically; spreading
  // its (empty, but typed) shape in keeps `metrics` structurally attached to a real
  // `ReportRecordData`-shaped value instead of a bare, unrelated object literal.
  const dataWithMetrics = { ...baseRecord.data, metrics: { textureBudgetBytes: 1048576 } };
  assert.equal(metricValue({ ...baseRecord, data: dataWithMetrics }, 'textureBudget'), 1);
  assert.equal(metricValue({ ...baseRecord, data: dataWithMetrics }, 'pool'), null);
});

test('complete source tables include primary and repeated readings plus failed-run metadata', () => {
  const run = { ...baseRun, id: 'r', name: 'mobile' },
    failed = { ...baseRun, id: 'f', name: 'failed' };
  const sources = [
    {
      run,
      data: {
        scene: 'scene',
        frames: 60,
        series: [
          {
            view: 'sol',
            pixelError: 1,
            sides: {
              apres: { moteur: 'webgpu', primaryCounter: 123 },
              'apres-aa': { moteur: 'webgpu', repeatCounter: 456 },
            },
          },
        ],
      },
    },
    {
      run: failed,
      data: { scene: 'scene', frames: 0, series: [], errors: ['measurement failed'] },
    },
  ];
  const html = renderToStaticMarkup(
    createElement(AllReadings, {
      report: { ...baseReport, runs: [run, failed] },
      sources,
      locale: 'en',
    }),
  );
  const expanded = JSON.stringify([...readingGroups(sources).values()]);
  for (const value of [
    '123',
    '456',
    'frames',
    'primaryCounter',
    'repeatCounter',
    'measurement failed',
    'series',
  ])
    assert.ok(expanded.includes(value), value);
  assert.doesNotMatch(html, /<table|undefined/);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /<details[^>]* open|<select/);
});

test('missing chart readings keep a disabled track and never announce a measured zero', () => {
  const html = renderToStaticMarkup(
    createElement(BarChart, {
      title: 'Memory',
      rows: [{ id: 'missing', label: 'Engine', value: null }],
      format: String,
      missingLabel: 'Not measured',
    }),
  );
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /aria-valuetext="Not measured"/);
  assert.match(html, /<progress/);
  assert.match(html, /<strong[^>]*>Not measured/);
});

test('campaign summary derives missing provenance from current readings', () => {
  const report: typeof baseReport = {
    ...baseReport,
    runs: [{ ...baseRun, id: 'r', name: 'other', status: 'complete' }],
    records: [
      {
        ...baseRecord,
        runId: 'r',
        provenance: { machine: { id: 'm' } },
        canvas: { width: 0, height: 0, dpr: 2 },
      },
    ],
  };
  const render = () => renderToStaticMarkup(createElement(Findings, { report, locale: 'en' }));
  assert.doesNotMatch(render(), /Machine identity is missing|DPR is missing/);
  report.records[0].canvas = { width: 0, height: 0 };
  assert.match(render(), /DPR is missing/);
  assert.doesNotMatch(render(), /Machine identity is missing/);
  report.records[0].provenance = null;
  assert.match(render(), /Machine identity is missing/);
});

test('scene limitations remain visible with their original campaign wording', () => {
  for (const locale of ['fr', 'en'] as const) {
    const html = renderToStaticMarkup(
      createElement(SceneNotice, {
        locale,
        note: '81 materials, 6 textured: the export omitted textures.',
      }),
    );
    assert.match(html, /81 materials, 6 textured/);
    assert.match(html, /alert-warning/);
    assert.match(html, locale === 'fr' ? /textures/ : /Source limitation/);
  }
});
