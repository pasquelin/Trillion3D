// #525: a sun page draws only the casters its own box meets; #1211: the whole page, a filter's taps
// past its edge read in the neighbour page, and never the camera's frustum: a caster off-camera
// over a receiver the camera sees is kept. The shader cannot run under node: the test
// restates its box test in TypeScript (`cullBox.fixture.ts`), and pins the shader's text it
// restates, so the two cannot drift apart silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_INDEX_MASK,
  PAGE_VALID,
  SHADOW_PAGE,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { sunPageMetres } from '../../../../sdk-core/src/scene/light-shadow/pageModel.ts';
import { SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER } from './cullShader.ts';
import { SHADER_BOX, keeps } from './cullBox.fixture.ts';
import { SHADOW_FRESH_CULL_WGSL } from '../../webgpu/shadow/freshCullWgsl.ts';
import { pcfPages } from '../../../../sdk-core/src/scene/light-shadow/pageModel.fixture.ts';
import {
  VIEW,
  planFrame,
  report,
  sunPageVolume,
  sunScene,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { PCF_REACH } from '../../lighting/direct/pcfTaps.ts';
import { shadingReads } from '../../webgpu/shadow/shadingReads.fixture.ts';

test("every cull runs the box test this file restates, the GPU pages' too", () => {
  for (const shader of [SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER, SHADOW_FRESH_CULL_WGSL])
    for (const line of SHADER_BOX) assert.ok(shader.includes(line), line);
});

test("a caster outside a page's square is not drawn into it; one reaching it is", () => {
  const { plan, slice } = sunScene();
  const level = plan.sun.finest[slice] + 4,
    size = sunPageMetres(level);
  const volume = sunPageVolume(plan, slice, level, 3, 2);
  const right = plan.sun.frame.subarray(slice * 9, slice * 9 + 3);
  const beside = (pages: number) => [0, 1, 2].map((a) => volume[a] + right[a] * pages * size);
  assert.ok(keeps(volume, beside(0), 0.1 * size), 'a caster inside the page');
  assert.ok(!keeps(volume, beside(1), 0.3 * size), 'a caster over the next page');
  assert.ok(keeps(volume, beside(0.7), 0.3 * size), 'a caster reaching over its edge');
});

test('a caster whose widened bounds miss a page is not drawn into it; its filter reads the next', () => {
  const { plan, slice } = sunScene();
  const level = plan.sun.finest[slice] + 4,
    texel = sunPageMetres(level) / SHADOW_PAGE,
    home = sunPageVolume(plan, slice, level, 3, 2),
    next = sunPageVolume(plan, slice, level, 4, 2),
    frame = plan.sun.frame.subarray(slice * 9, slice * 9 + 6);
  // The world point of texel `(x, y)` of page (3, 2), on the plane of its box's centre.
  const at = (x: number, y: number) => {
    const u = (x - SHADOW_PAGE / 2) * texel,
      v = (SHADOW_PAGE / 2 - y) * texel;
    return [0, 1, 2].map((a) => home[a] + frame[a] * u + frame[3 + a] * v);
  };
  // A receiver on the page's last texel: its filter's taps reach past the edge, into page (4, 2),
  // which its read asks for (`shadowPcf`, `pcfPages`).
  const t = [4 * SHADOW_PAGE - 0.5, 2 * SHADOW_PAGE + SHADOW_PAGE / 2];
  assert.deepEqual(pcfPages(t, [3, 2]), [
    [3, 2],
    [4, 2],
  ]);
  // A caster one texel past the edge, within the filter's reach of that receiver.
  const past = at(SHADOW_PAGE + 1, SHADOW_PAGE / 2);
  assert.ok(1.5 < PCF_REACH, 'within the reach');
  assert.ok(!keeps(home, past, 0.5 * texel), 'its bounds miss the page: not drawn into it');
  assert.ok(keeps(next, past, 0.5 * texel), 'drawn into the neighbour page the filter reads');
  assert.ok(keeps(home, at(SHADOW_PAGE - 1, SHADOW_PAGE / 2), 0.5 * texel), 'one over the page is');
});

test('an off-camera wall over a visible floor keeps its shadow pages and casters', () => {
  // A scene twenty metres high, the sun straight overhead: a wall block 15 m up, over a floor
  // point ten metres ahead of the eye. The eye (5 m up, looking down −Z) sees the floor, not the wall.
  const min = [-50, 0, -50],
    max = [50, 20, 50],
    { store, plan, slice } = sunScene(min, max);
  const floor = [0, 0, -10],
    wall = [0, 15.5, -10];
  const above = (p: number[]) => Math.atan2(p[1] - VIEW.position[1], VIEW.position[2] - p[2]);
  assert.ok(above(wall) > VIEW.halfFovY, 'the wall is off-camera');
  assert.ok(-above(floor) < VIEW.halfFovY, 'the floor is seen');
  // The shading of the floor asks for its pages; the next frame maps and draws them.
  const reads = shadingReads(plan, store, VIEW, [{ P: floor, N: [0, 1, 0] }]);
  assert.ok(reads.length > 0);
  report(plan, store, 1, reads);
  planFrame(plan, store, 1, VIEW, min, max);
  plan.commit();
  for (const entry of reads) {
    const word = plan.table.words[entry];
    assert.ok(word & PAGE_VALID, `the floor's page ${entry} is kept and drawn`);
    const page = word & PAGE_INDEX_MASK,
      { pool } = plan,
      volume = sunPageVolume(plan, slice, pool.view[page], pool.x[page], pool.y[page]);
    assert.ok(keeps(volume, wall, 0.5), `the wall is drawn into page ${entry}`);
  }
});
