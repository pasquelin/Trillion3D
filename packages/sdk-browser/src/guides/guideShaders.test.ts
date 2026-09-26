// The guide program: the depth rule of the WebGPU pass (its TypeScript twin, and the shader that
// copies it), and the corners both programs place with the engine's line corner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUIDE_CORNER_GLSL,
  GUIDE_CORNER_WGSL,
  GUIDE_GLSL_VERTEX,
  GUIDE_WGSL,
  jitterDepthSlack,
} from './guideShaders.ts';
import { LINE_CLIP_GLSL, LINE_CLIP_WGSL } from '../visibility/shader/lineWgsl.ts';
import { runShaderText } from '../visibility/shader/shaderText.fixture.ts';
import {
  LINE_PROJECTIONS,
  LINE_VIEWPORT,
  toPixels,
} from '../visibility/shader/lineProjection.fixture.ts';

/** Reversed depth of a tilted plane at pixel `(x, y)`, the jitter `(jx, jy)` pixels applied. */
const plane =
  (jx = 0, jy = 0) =>
  (x: number, y: number) =>
    0.5 + 0.01 * (x - jx) - 0.03 * (y - jy);

test('the depth slack covers exactly what the jitter moved on a plane, and nothing unjittered', () => {
  const jitter = [-0.375, -0.1];
  const scene = plane(...(jitter as [number, number])),
    guide = plane()(4, 4);
  const slack = jitterDepthSlack(scene, 4, 4, jitter);
  assert.ok(Math.abs(slack - (0.375 * 0.01 + 0.1 * 0.03)) < 1e-12, 'jitter times slope, per axis');
  assert.ok(guide >= scene(4, 4) - slack, 'a guide on the plane passes the test');
  assert.ok(guide < scene(4, 4), 'where the bare test would have hidden it');
  assert.equal(jitterDepthSlack(scene, 4, 4, [0, 0]), 0, 'no jitter, no slack');
  assert.ok(0.4 < scene(4, 4) - slack, 'a guide behind the plane stays hidden');
});

test('a silhouette beside the pixel opens no hole: the gentler side gives the slope', () => {
  const edge = (x: number, y: number) => (x > 4 ? 0.1 : plane()(x, y));
  assert.ok(
    Math.abs(jitterDepthSlack(edge, 4, 4, [0.5, 0]) - 0.5 * 0.01) < 1e-12,
    'the far background right of the pixel is not a slope',
  );
});

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

// #264 audit: the guides draw with the engine's line corner (`lineClip`), not a second program,
// and count their width as every line does — CSS pixels times the host's pixel ratio.
type Language = 'wgsl' | 'glsl';
const CORNER = { wgsl: GUIDE_CORNER_WGSL, glsl: GUIDE_CORNER_GLSL },
  CLIP = { wgsl: LINE_CLIP_WGSL, glsl: LINE_CLIP_GLSL };
const QUAD = [
  [0, -1],
  [1, -1],
  [1, 1],
  [0, 1],
];
const project = (language: Language, [x, y, z]: number[]) => LINE_PROJECTIONS[language](x, y, z, 1);
/** One corner of the guide `a → b` as the real shader text places it, in clip space. */
function corner(
  language: Language,
  a: number[],
  b: number[],
  at: number[],
  width: number,
  ratio = 1,
) {
  const run = runShaderText(CORNER[language], { lineClip: runShaderText(CLIP[language]) });
  return run(project(language, a), project(language, b), at, width, LINE_VIEWPORT, ratio);
}
/** The guide's four corners, in image pixels. */
const quad = (language: Language, a: number[], b: number[], width: number, ratio = 1) =>
  QUAD.map((at) => toPixels(corner(language, a, b, at, width, ratio)));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

for (const language of ['wgsl', 'glsl'] as const) {
  test(`${language}: a guide segment is its CSS width times the pixel ratio, capped half a width`, () => {
    const a = [-1, 0.2, -6],
      b = [1.5, 0.2, -6];
    const [ea, eb] = [a, b].map((p) => toPixels(project(language, p)));
    for (const ratio of [1, 2]) {
      const [p0, p1, p2, p3] = quad(language, a, b, 3, ratio),
        drawn = 3 * ratio;
      assert.ok(near(p3[1] - p0[1], drawn) && near(p2[1] - p1[1], drawn), `ratio ${ratio}: width`);
      assert.ok(near(ea[0] - p0[0], drawn / 2) && near(p1[0] - eb[0], drawn / 2), 'the caps');
      assert.ok(near(p0[1] + drawn / 2, ea[1]), 'centred on the segment');
    }
  });

  test(`${language}: a dot is a square of its size times the pixel ratio`, () => {
    const at = [0.4, -0.3, -4],
      centre = toPixels(project(language, at));
    const [p0, , p2] = quad(language, at, at, 7, 2);
    for (const i of [0, 1]) assert.ok(near(p2[i] - p0[i], 14) && near(p0[i] + 7, centre[i]));
  });

  test(`${language}: a guide behind the eye draws nothing, one crossing it starts on the near plane`, () => {
    const behind = quad(language, [-1, 0, 2], [1, 0, 3], 4);
    const area = behind.reduce((sum, p, i) => {
      const q = behind[(i + 1) % 4];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0);
    assert.ok(Math.abs(area) < 1e-6, `no area: ${area}`);
    const c = corner(language, [0.5, 0, 1], [0.5, 0, -10], [0, 1], 2);
    const onNear = language === 'wgsl' ? c[3] - c[2] : c[3] + c[2];
    assert.ok(Math.abs(onNear) < 1e-9 && c[3] > 0, 'on the near plane, in front of the eye');
  });
}

test('both guide programs place their corners with that text', () => {
  for (const [program, clip, own] of [
    [GUIDE_WGSL, LINE_CLIP_WGSL, GUIDE_CORNER_WGSL],
    [GUIDE_GLSL_VERTEX, LINE_CLIP_GLSL, GUIDE_CORNER_GLSL],
  ])
    assert.ok(program.includes(clip) && program.includes(own));
});
