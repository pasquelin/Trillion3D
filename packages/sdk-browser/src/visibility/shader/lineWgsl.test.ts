import test from 'node:test';
import assert from 'node:assert/strict';
import { LINE_CLIP_GLSL, LINE_CLIP_WGSL } from './lineWgsl.ts';
import { runLineClip } from './lineClip.fixture.ts';
import { PAGE_INFO_STRUCT_WGSL } from './pageWgsl.ts';
import { VIS_SHADER } from './visWgsl.ts';
import { SHADE_SHADER } from './shadeWgsl.ts';
import { rasterSource } from '../../gpu/raster/shader.ts';
import { BLEND_SHADER } from '../../webgpu/blend/shader.ts';
import { BLEND_ITEM_WGSL } from '../../webgpu/blend/items.ts';
import { CLUSTER_VERTEX } from '../../webgl/cluster/shaders.ts';

const VIEWPORT = [800, 600];
const NEAR = 0.1;
const FOCAL = 1 / Math.tan(Math.PI / 6);
type V4 = number[];
/** The engine's projection (reversed depth, infinite far: `z = near`, `w = distance`) and a
 *  forward one (`z = −w` at the near plane) as the WebGL2 path draws, on a view-space vector. */
const PROJECTIONS = {
  wgsl: (x: number, y: number, z: number, w: number): V4 => [
    (FOCAL * x * VIEWPORT[1]) / VIEWPORT[0],
    FOCAL * y,
    NEAR * w,
    -z,
  ],
  glsl: (x: number, y: number, z: number, w: number): V4 => [
    (FOCAL * x * VIEWPORT[1]) / VIEWPORT[0],
    FOCAL * y,
    -1.002 * z - 0.2002 * w,
    -z,
  ],
};
const SOURCES = { wgsl: LINE_CLIP_WGSL, glsl: LINE_CLIP_GLSL };
const pixel = (c: V4) => [0, 1].map((i) => (c[i] / c[3]) * 0.5 * VIEWPORT[i]);

/** The two corners of an endpoint `p` of the segment of direction `d`, widened to `width`. */
function corners(language: keyof typeof SOURCES, p: number[], d: number[], width: number) {
  const run = runLineClip(SOURCES[language]),
    project = PROJECTIONS[language];
  const clip = project(p[0], p[1], p[2], 1);
  return [1, -1].map((side) =>
    run(clip, project(d[0] * side, d[1] * side, d[2] * side, 0), width, VIEWPORT),
  );
}

// #348: a line's width is a screen width. The real text of both shaders moves the two corners of
// an endpoint apart by `width` pixels, perpendicular to the segment on screen, at every distance.
for (const language of ['wgsl', 'glsl'] as const)
  test(`${language}: an endpoint's corners are the line's width apart on screen, near and far`, () => {
    const d = [0.8, 0.6, 0];
    for (const distance of [2, 20, 200])
      for (const width of [1, 3]) {
        const [left, right] = corners(language, [0.3, -0.2, -distance], d, width).map(pixel);
        const gap = [left[0] - right[0], left[1] - right[1]];
        assert.ok(Math.abs(Math.hypot(...gap) - width) < 1e-6, `${distance} m, ${width} px`);
        // Perpendicular to the segment, which runs along (0.8, 0.6) on screen too.
        assert.ok(Math.abs(gap[0] * 0.8 + gap[1] * 0.6) < 1e-6);
        assert.ok(gap[0] * 0.6 - gap[1] * 0.8 < 0, 'the +d corner moves to the left');
      }
  });

for (const language of ['wgsl', 'glsl'] as const)
  test(`${language}: a corner behind the camera slides onto the near plane along its segment`, () => {
    // From 1 m behind the eye to 10 m ahead: the drawn part starts on the near plane.
    const [corner] = corners(language, [0.5, 0, 1], [0, 0, -1], 2);
    const onNear = language === 'wgsl' ? corner[3] - corner[2] : corner[3] + corner[2];
    assert.ok(Math.abs(onNear) < 1e-9, 'on the near plane');
    assert.ok(corner[3] > 0, 'in front of the eye');
  });

for (const language of ['wgsl', 'glsl'] as const)
  test(`${language}: a segment seen end-on keeps no width`, () => {
    const clip = PROJECTIONS[language](0, 0, -5, 1);
    const [left, right] = corners(language, [0, 0, -5], [0, 0, -1], 4);
    assert.deepEqual(left, clip);
    assert.deepEqual(right, clip);
  });

// Every raster reads a line page's corners widened, and only a line page's: the expressions a
// triangle page draws with stay, character for character, what they were.
test('every page-geometry raster widens a line page, and a triangle page draws as before', () => {
  assert.match(PAGE_INFO_STRUCT_WGSL, /depthBias:u32,lineWidth:f32,placement:u32/);
  const raster = rasterSource(4, 16);
  assert.match(raster, /let ca=pageClip\(vp,page,h,ia\);let cb=pageClip\(vp,page,h,ib\);/);
  assert.match(VIS_SHADER, /computeTakes\(pageClip\(vp,page,h,ia\),pageClip\(vp,page,h,ib\)/);
  const hardware =
    ' out.position=uni.viewProj*world;\n if(page.lineWidth>0.0){out.position=pageLine(page,h,id,uni.viewProj*page.world,out.position);}';
  assert.equal(VIS_SHADER.split(hardware).length - 1, 2, 'both hardware vertex stages');
  assert.match(SHADE_SHADER, /var c0=uni\.viewProj\*w0;var c1=uni\.viewProj\*w1;/);
  assert.match(
    SHADE_SHADER,
    /if\(page\.lineWidth>0\.0\)\{let vp=uni\.viewProj\*page\.world;c0=pageLine/,
  );
  assert.match(BLEND_ITEM_WGSL, /emissiveIndex:u32,lineWidth:f32,alphaTest/);
  assert.match(BLEND_SHADER, /out\.position=uni\.viewProj\*world;out\.view=world\.xyz;/);
  assert.match(BLEND_SHADER, /if\(it\.lineWidth>0\.0\)\{out\.position=lineClip\(out\.position,/);
  assert.ok(BLEND_SHADER.includes(LINE_CLIP_WGSL));
  assert.ok(CLUSTER_VERTEX.includes(LINE_CLIP_GLSL));
  assert.match(CLUSTER_VERTEX, /gl_Position=projectionMatrix\*view;\nif\(lineWidth>0\.0\)/);
});
