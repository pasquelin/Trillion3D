// The guide program: the depth rule of the WebGPU pass (its TypeScript twin, and the shader that
// copies it), and the corners both programs place with the engine's line corner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_WGSL } from './guideShaders.ts';

test('the shader applies the rule of jitterDepthSlack: slack on the test, gentler side, |jitter|', () => {
  assert.match(
    GUIDE_WGSL,
    /if \(in\.position\.z < scene - jitterSlack\(p, scene\)\) \{ discard; \}/,
  );
  assert.match(
    GUIDE_WGSL,
    /min\(abs\(sceneAt\(p \+ axis\) - centre\), abs\(centre - sceneAt\(p - axis\)\)\)/,
  );
  assert.match(GUIDE_WGSL, /abs\(view\.viewport\.z\) \* slopeAlong\(p, vec2i\(1, 0\), centre\)/);
  assert.match(GUIDE_WGSL, /abs\(view\.viewport\.w\) \* slopeAlong\(p, vec2i\(0, 1\), centre\)/);
});
