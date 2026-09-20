import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.mjs';
import { parseRoute, routeHref, resolvePage } from '../docs/js/portal/routes.js';
import { readSelection, writeSelection } from '../docs/js/reports/selection.js';
import { reportCopy, METRIC_COPY } from '../docs/js/reports/copy.js';

test('report selections survive share links and a locale switch', () => {
  const selection = {
    campaign: 'sept-20',
    scene: 'city~west café',
    view: 'sol',
    quality: '0',
    left: 'a',
    right: 'b',
    variable: 'version',
    campaignB: 'sept-21',
  };
  for (const locale of ['en', 'fr']) {
    const route = parseRoute(routeHref({ locale, area: 'reports', id: writeSelection(selection) }));
    assert.deepEqual(readSelection(route.id), selection);
    assert.equal(resolvePage(route, []).kind, 'report');
    assert.deepEqual(
      readSelection(parseRoute(routeHref({ ...route, locale: 'en' })).id),
      selection,
    );
  }
  assert.deepEqual(Object.keys(reportCopy('en')), Object.keys(reportCopy('fr')));
  assert.ok(Object.values(METRIC_COPY).every((pair) => pair.length === 2 && pair.every(Boolean)));
});

test('comparison renders bilingual accessible values without treating missing GPU time as zero', async () => {
  const { Comparison } = await loadReactComponents('docs/react/reports/Comparison.jsx');
  for (const locale of ['en', 'fr']) {
    const html = renderToStaticMarkup(
      createElement(Comparison, { locale, a: { id: 'a', data: {} }, b: null, variable: 'engine' }),
    );
    assert.match(html, /scope="row"/);
    assert.ok(html.includes(reportCopy(locale).p95));
    assert.match(html, /—/);
    assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  }
});
