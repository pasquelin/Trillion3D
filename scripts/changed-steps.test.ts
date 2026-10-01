import test from 'node:test';
import assert from 'node:assert/strict';
import { changedSteps, isDocumentation } from './changed-steps.ts';

test('a documentation change runs no build, no type check and no line bound, the cohesion one included', () => {
  const changed = ['docs/ENGINE.md', 'README.md'];
  const steps = changedSteps(changed, changed, 1);
  for (const step of ['check:lines', 'check:cohesion', 'types', 'check:unused'] as const)
    assert.equal(steps.includes(step), false, step);
  assert.ok(steps.includes('check:links'));
});

test('a source change runs the cohesion bound: it is what a runtime module answers to now', () => {
  const changed = ['packages/sdk-browser/src/gpu/dag/uniforms.ts'];
  assert.ok(changedSteps(changed, changed, 1).includes('check:cohesion'));
  // A change that touches no source cannot make a function longer, so the bound is not run.
  const docs = ['docs/ENGINE.md'];
  assert.equal(changedSteps(docs, docs, 1).includes('check:cohesion'), false);
});

test('a documentation, image or translation change runs no build or cache compilation, and only the tests that read it', () => {
  const changed = ['README.md', 'site/i18n/fr.json', 'site/assets/logo.png'];
  assert.deepEqual(changedSteps(changed, changed, 12), [
    'format',
    'check:links',
    'check:i18n',
    'check:translations',
    'check:english',
    'tests',
  ]);
  assert.ok(!changedSteps(changed, changed, 0).includes('tests'));
  // The notices ship in the package: code, not documentation.
  assert.equal(isDocumentation('THIRD_PARTY_NOTICES.md'), false);
});

test('a source change runs the gates, the type check and the tests it selects', () => {
  const changed = ['packages/sdk-core/src/a.ts', 'README.md'];
  const steps = changedSteps(changed, changed, 3);
  for (const step of [
    'generate:api',
    'compile:caches',
    'check:lines',
    'check:cohesion',
    'types',
    'check:unused',
    'tests',
    'check:links',
  ] as const)
    assert.ok(steps.includes(step), step);
  // A fixture image is read by the tests: it is not documentation.
  assert.ok(changedSteps(['tests/fixtures/a.png'], [], 1).includes('tests'));
  // A scene source or model texture is cooked into the caches the Rust tests read: code too.
  for (const texture of [
    'site/assets/examples/terrain-tiles/source/ground.png',
    'site/assets/gallery/signature-architecture/source/a.png',
    'site/assets/examples/models/crate/box1.png',
  ])
    assert.equal(isDocumentation(texture), false, texture);
  assert.equal(isDocumentation('site/assets/examples/thumbnails/crates.webp'), true);
  // English types the site's dictionaries (`site/content/i18n/dictionary.ts`): code.
  assert.equal(isDocumentation('site/i18n/en.json'), false);
});
