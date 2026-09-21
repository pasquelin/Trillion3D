import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiScenario } from '../site/lessons/apiScenario.ts';
import { evaluate } from '../site/lessons/evaluate.ts';

test('API functions resolve to a visual example', () => {
  // The site's apiScenario takes a section as a fallback key: both calls below resolve before
  // that parameter is read (a direct hit, then a miss with no section to fall back to).
  assert.equal(apiScenario('crossVector3', ''), 'cross-product');
  assert.equal(apiScenario('missing', ''), undefined);
});

test('visible engine results follow the selected language', () => {
  const french = evaluate('frustum', { x: 0, depth: 4, fov: 55 }, 'fr');
  assert.equal(french.value, 'dedans');
});
