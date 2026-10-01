import assert from 'node:assert/strict';
import test from 'node:test';
import { presentAtShader } from './presentWgsl.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { linearToSrgb } from '../../../../sdk-core/src/math/primitives/color.ts';

test('XR presentation keeps encoded pixels and alpha through linear and sRGB attachments', () => {
  for (const format of ['rgba8unorm', 'bgra8unorm-srgb'] as const) {
    let source = [0, 0, 0, 0];
    const program = shaderRun<{ presentAt(placed: object): number[] }>(
      presentAtShader(format),
      format.endsWith('-srgb') ? ['presentDecode', 'presentAt'] : ['presentAt'],
      { image: {}, textureLoad: () => source },
    );
    for (const value of [0, 0.003, 0.04045, 0.1, 0.5, 0.9, 1]) {
      source = [value, 1 - value, value / 2, 0.37];
      const written = program.presentAt({ position: [2, 3, 0, 1], origin: [0, 0] });
      const stored = written.map((channel, i) =>
        i < 3 && format.endsWith('-srgb') ? linearToSrgb(channel) : channel,
      );
      stored.forEach((channel, i) => assert.ok(Math.abs(channel - source[i]) < 1e-6));
      assert.equal(written[3], source[3]);
    }
  }
});
