// The guide program: the WebGPU pass's shader applies the depth rule of its TypeScript twin,
// `jitterDepthSlack`.
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
