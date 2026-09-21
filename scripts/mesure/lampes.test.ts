// `--portee`: the range of a grid light is a multiple of its cell, so the bench can make
// several lights reach one pixel — the case sampled lighting is measured on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { benchLights } from './lampes.ts';

const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 40, y: 10, z: 40 } };
const settings = { lights: 4, lightShadows: false, lightIntensity: 10, sun: false };

test('the range factor scales every grid light by its cell and is published in the summary', () => {
  const plain = benchLights(bounds, settings),
    wide = benchLights(bounds, { ...settings, lightRangeFactor: 3 });
  assert.ok(plain);
  assert.ok(wide);
  assert.equal(plain.resume.portee, 0.75);
  assert.equal(wide.resume.portee, 3);
  assert.equal(plain.resume.maille, wide.resume.maille, 'the grid itself does not move');
  for (let i = 0; i < 4; i++) {
    assert.equal(plain.lights[i].range, plain.resume.maille * 0.75);
    assert.equal(wide.lights[i].range, wide.resume.maille * 3);
    assert.deepEqual(wide.lights[i].position, plain.lights[i].position);
  }
});
