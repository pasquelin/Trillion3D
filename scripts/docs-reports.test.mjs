import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.mjs';
import { parseRoute, routeHref, resolvePage } from '../docs/js/portal/routes.js';
import { reportCopy, METRIC_COPY } from '../docs/js/reports/copy.js';
import { flattenFields } from '../docs/js/reports/availability.js';
import { pairedImages } from '../docs/js/reports/presentation.js';
import { readingGroups } from '../docs/js/reports/sources.js';
import { metricValue } from '../docs/js/reports/metrics.js';

test('report routes and labels remain bilingual without a selection form', () => {
  for (const locale of ['en', 'fr']) {
    const route = parseRoute(routeHref({ locale, area: 'reports', id: 'september-18' }));
    assert.equal(route.id, 'september-18');
    assert.equal(resolvePage(route, []).kind, 'report');
  }
  assert.deepEqual(Object.keys(reportCopy('en')), Object.keys(reportCopy('fr')));
  assert.ok(Object.values(METRIC_COPY).every((pair) => pair.length === 2 && pair.every(Boolean)));
});

test('comparison names engines, explains missing values and shows observed arithmetic', async () => {
  const { Comparison } = await loadReactComponents('docs/react/reports/Comparison.jsx');
  const a = { id: 'a', engine: 'three-nu', settings: {}, data: { cpuFrameMs: { p50: 4 } } };
  const b = {
    id: 'b',
    engine: 'webgpu-page-raster',
    settings: {},
    data: { cpuFrameMs: { p50: 1 } },
  };
  for (const locale of ['en', 'fr']) {
    const html = renderToStaticMarkup(
      createElement(Comparison, { locale, a, b, variable: 'engine' }),
    );
    assert.match(html, /Three.js/);
    assert.match(html, /Web Geometry/);
    assert.match(html, /-3 ms/);
    assert.doesNotMatch(html, /<details|<select|NaN|Infinity|undefined|>A<|>B</);
  }
});

test('image pairing never combines different measured frames', async () => {
  const a = { id: 'a', engine: 'three-nu', image: 'a.png', differencePair: 'pair', data: {} };
  const b = { ...a, id: 'b', engine: 'webgpu-page-raster', image: 'b.png' };
  assert.deepEqual(pairedImages([a, b, { ...b, id: 'c', differencePair: 'other' }]), [[a, b]]);
  const { Evidence } = await loadReactComponents('docs/react/reports/Evidence.jsx');
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
  assert.equal(
    metricValue({ data: { metrics: { textureBudgetBytes: 1048576 } } }, 'textureBudget'),
    1,
  );
  assert.equal(metricValue({ data: { metrics: { textureBudgetBytes: 1048576 } } }, 'pool'), null);
});

test('complete source tables include primary and repeated readings plus failed-run metadata', async () => {
  const { AllReadings } = await loadReactComponents('docs/react/reports/AllReadings.jsx');
  const run = { id: 'r', name: 'mobile' },
    failed = { id: 'f', name: 'failed' };
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
    createElement(AllReadings, { report: { runs: [run, failed] }, sources, locale: 'en' }),
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

test('missing chart readings keep a disabled track and never announce a measured zero', async () => {
  const { BarChart } = await loadReactComponents('docs/react/components/BarChart.jsx');
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

test('campaign summary derives missing provenance from current readings', async () => {
  const { Findings } = await loadReactComponents('docs/react/reports/Findings.jsx');
  const report = {
    runs: [{ id: 'r', name: 'other', status: 'complete' }],
    records: [{ runId: 'r', provenance: { machine: { id: 'm' } }, canvas: { dpr: 2 } }],
  };
  const render = () => renderToStaticMarkup(createElement(Findings, { report, locale: 'en' }));
  assert.doesNotMatch(render(), /Machine identity is missing|DPR is missing/);
  report.records[0].canvas = {};
  assert.match(render(), /DPR is missing/);
  assert.doesNotMatch(render(), /Machine identity is missing/);
  report.records[0].provenance = null;
  assert.match(render(), /Machine identity is missing/);
});

test('scene limitations remain visible with their original campaign wording', async () => {
  const { SceneNotice } = await loadReactComponents('docs/react/reports/SceneNotice.jsx');
  for (const locale of ['fr', 'en']) {
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
