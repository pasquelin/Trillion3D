import test from 'node:test';
import assert from 'node:assert/strict';
import { observationSources } from './program.ts';

test('the observation shaders compile as one engine program: 3.00 profile, no host include', () => {
  const { vertex, fragment } = observationSources(3);
  for (const source of [vertex, fragment]) {
    assert.ok(source.startsWith('#version 300 es\n'), 'the profile is the first line');
    assert.ok(!source.includes('#include'), 'no host include remains');
  }
  assert.match(vertex, /in vec3 position;/);
  assert.match(vertex, /uniform mat4 modelMatrix,viewMatrix,projectionMatrix;/);
  assert.match(fragment, /#define SURFACE_COUNT 3\n/);
  assert.match(fragment, /uniform vec3 cameraPosition;uniform bool toneMapped;/);
  // The display chain in place of the two includes, in the order the host applied them.
  const tone = fragment.indexOf('if(toneMapped)gl_FragColor.rgb=toneMap(gl_FragColor.rgb);'),
    transfer = fragment.indexOf('gl_FragColor.rgb=linearToSrgb(gl_FragColor.rgb);');
  assert.ok(tone > 0 && transfer > tone, 'tone mapping, then the sRGB transfer');
});
