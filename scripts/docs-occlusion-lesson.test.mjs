import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { rendererLessons } from '../docs/js/gallery/rendererLessons.js';
import { rendererCodeFor } from '../docs/js/gallery/rendererLessonCode.js';
import { loadReactComponents } from './docs/render-react.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const { Playground } = await loadReactComponents('docs/react/gallery/index.jsx');

test('the occlusion lesson lowers the eye on the garden and its proof counts what the pyramid hid', async () => {
  const lesson = rendererLessons.find(({ id }) => id === 'occlusion-two-phase');
  assert.equal(lesson.manifest, './assets/kinetic-garden/cache/native/full/manifest.json');
  assert.equal(lesson.referenceCoverage.webgpu_occlusion, 'full');
  const low = rendererCodeFor(lesson, { height: 1.45, angle: 90 }),
    high = rendererCodeFor(lesson, { height: 6, angle: 0 });
  assert.match(low, /Math\.sin\(angle\) \* radius, 1\.45, /);
  assert.match(high, /Math\.sin\(angle\) \* radius, 6, /);
  const proof = JSON.parse(
    await readFile(
      new URL('../docs/assets/gallery/proofs/occlusion-two-phase-proof.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(proof.scene, lesson.manifest);
  const at = (height, angle) =>
    proof.samples.find((sample) => sample.height === height && sample.angle === angle);
  assert.ok(
    proof.samples.every((sample) => sample.held),
    'every pose was held before reading',
  );
  assert.ok(at(1.45, 90).hizRejectedClusters > at(1.45, 0).hizRejectedClusters);
  assert.ok(at(1.45, 0).hizRejectedClusters > at(1.45, 45).hizRejectedClusters);
  assert.equal(at(6, 0).hizRejectedClusters, 0, 'nothing hides a ring seen from above');
  const markup = renderToStaticMarkup(createElement(Playground, { id: lesson.id, locale: 'en' }));
  assert.match(markup, /aria-label="Eye height"/);
  assert.match(markup, /Occluded clusters/);
});
