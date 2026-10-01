import test from 'node:test';
import assert from 'node:assert/strict';
import type { LightingSceneLight, Vec3 } from './types.ts';
import { createLightingSceneGeometry } from './geometry.ts';
import { addLightingSceneObjects } from './objects.ts';
import { LIGHTING_EYE, LIGHTING_PANEL_RADIANCE } from './controls.ts';
import { close, cross, dot, sub } from '../../../../../tests/fixtures/lightingSceneTestHelpers.ts';

const light = (id: string, position: Vec3 = [3, 4, 5]): LightingSceneLight => ({
  id,
  position,
  color: [0.5, 0.25, 1],
  intensity: 2,
});
function objects(lights: LightingSceneLight[], intensity = 3) {
  const geometry = createLightingSceneGeometry(1);
  addLightingSceneObjects(geometry, lights, intensity);
  return {
    panels: geometry.surfaces.slice(0, lights.length),
    mirrors: geometry.surfaces.slice(lights.length),
  };
}
const centre = (surface: { origin: Vec3; u: Vec3; v: Vec3 }) =>
  surface.origin.map((value, axis) => value + (surface.u[axis] + surface.v[axis]) / 2) as Vec3;

test('panels keep one order whatever the order of the lights: warm first, then by name', () => {
  const names = (ids: string[]) => objects(ids.map((id) => light(id))).panels.map((p) => p.id);
  const expected = ['ceiling_emitter', 'ceiling_emitter_aaa', 'ceiling_emitter_zzz'];
  assert.deepEqual(names(['zzz', 'warm', 'aaa']), expected);
  assert.deepEqual(names(['aaa', 'zzz', 'warm']), expected);
  assert.deepEqual(names(['warm', 'zzz', 'aaa']), expected);
  assert.deepEqual(names(['zzz', 'aaa']), expected.slice(1));
});

test('each panel is a moving diffuse emitter centred on its light and facing down', () => {
  const positions: Vec3[] = [
    [3, 4, 5],
    [-1, 2.5, 0.5],
  ];
  for (const panel of objects([light('warm', positions[0]), light('cyan', positions[1])]).panels) {
    const position = positions[panel.id === 'ceiling_emitter' ? 0 : 1];
    centre(panel).forEach((value, axis) => close(value, position[axis]));
    const normal = cross(panel.u, panel.v);
    assert.ok(normal[1] < 0 && normal[0] === 0 && normal[2] === 0, panel.id);
    assert.deepEqual([panel.kind, panel.moving], ['diffuse', true]);
  }
});

test('the warm panel is the large one; every other panel shares one smaller size', () => {
  const area = (surface: { u: Vec3; v: Vec3 }) => Math.hypot(...cross(surface.u, surface.v));
  const [warm, ...others] = objects(['warm', 'b', 'c'].map((id) => light(id))).panels;
  assert.ok(others.every((panel) => area(panel) < area(warm)));
  assert.equal(new Set(others.map(area)).size, 1);
});

test('a panel emits its colour at its intensity times the scene intensity', () => {
  for (const intensity of [0, 1, 3]) {
    const [panel] = objects([light('warm')], intensity).panels;
    assert.deepEqual(
      panel.emission,
      light('warm').color.map((value) => value * LIGHTING_PANEL_RADIANCE * 2 * intensity),
    );
  }
});

test('the two mirrors stand still, upright and facing the camera', () => {
  const { mirrors } = objects([]);
  const eye = LIGHTING_EYE;
  assert.equal(mirrors.length, 2);
  for (const mirror of mirrors) {
    assert.deepEqual([mirror.kind, mirror.moving], ['mirror', false]);
    close(mirror.u[1], 0);
    close(dot(mirror.u, mirror.v), 0);
    const normal = cross(mirror.u, mirror.v);
    assert.ok(dot(normal, sub(eye, centre(mirror))) > 0, mirror.id);
    assert.ok(mirror.albedo.every((value) => value > 0 && value <= 1));
  }
});
