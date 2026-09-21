import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.mjs';

const { ProgressiveList } = await loadReactComponents('site/app/components/ProgressiveList.tsx');
const labels = {
  previous: 'Load previous results',
  next: 'Load more results',
  loading: 'Loading…',
  end: 'End of results',
};

test('restored progressive lists mount at most three batches with accessible controls', () => {
  const items = Array.from({ length: 100 }, (_, index) => `item-${index}`);
  const html = renderToStaticMarkup(
    createElement(ProgressiveList, {
      items,
      labels,
      batchSize: 24,
      maxBatches: 3,
      initialState: { start: 1, end: 3, heights: { 0: 500 } },
      renderItem: (item) => createElement('span', { key: item }, item),
    }),
  );
  assert.match(html, /data-mounted-items="72"/);
  assert.match(html, /height:500px/);
  assert.match(html, /type="button"[^>]*>Load previous results/);
  assert.match(html, /type="button"[^>]*>Load more results/);
  assert.doesNotMatch(html, /item-0</);
  assert.match(html, /item-24</);
  assert.match(html, /item-95</);
  assert.doesNotMatch(html, /item-96</);

  const end = renderToStaticMarkup(
    createElement(ProgressiveList, {
      items,
      labels,
      batchSize: 24,
      maxBatches: 3,
      initialState: { start: 2, end: 4 },
      renderItem: (item) => createElement('span', { key: item }, item),
    }),
  );
  assert.match(end, /role="status">End of results/);
  assert.doesNotMatch(end, /Load more results/);
});
