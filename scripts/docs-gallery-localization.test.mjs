import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiScenario } from '../docs/js/gallery/apiScenario.js';
import { evaluate } from '../docs/js/gallery/evaluate.js';

test('API functions resolve to a visual example', () => {
  assert.equal(apiScenario('crossVector3'), 'cross-product');
  assert.equal(apiScenario('missing'), undefined);
});

test('visible engine results follow the selected language', () => {
  const french = evaluate('frustum', { x: 0, depth: 4, fov: 55 }, 'fr');
  assert.equal(french.value, 'dedans');
});
