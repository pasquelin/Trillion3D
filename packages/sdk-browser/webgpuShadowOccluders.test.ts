// The host replay of the region cull: a box region keeps the spheres that touch its column and
// drops the others, exactly as the compute shader does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS, type SceneLight, type ShadowViewpoint } from '../sdk-core/index.ts';
import { writeFace, regionRect } from '../sdk-core/index.ts';
import { countShadowOccluders } from './webgpuShadowOccluders.ts';
import type { WebgpuLightState } from './webgpuPagesStateLights.ts';

const VIEW: ShadowViewpoint = {
  position: [0, 5, 0],
  forward: [0, 0, -1],
  halfFovY: 0.5,
  aspect: 1,
  near: 0.1,
  far: 500,
};
const SUN: SceneLight = {
  id: 'sun',
  kind: 'directional',
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 1,
  castsShadow: true,
};

test('a column region of a sun cascade keeps the spheres in its column and drops the rest', () => {
  const volumes = new Float32Array(SHADOW_CULL_FLOATS);
  const matrix = new Float32Array(16);
  // The leftmost column of the first cascade, at side 1024: eight pages tall, one page wide.
  writeFace(
    matrix,
    0,
    volumes,
    0,
    SUN,
    0,
    VIEW,
    1024,
    regionRect(new Float64Array(4), 8, 0, 0, 0, 7),
  );
  const centre = [volumes[0], volumes[1], volumes[2]];
  const halfU = volumes[11],
    halfDepth = volumes[3];
  // Sphere at the box centre; one just past the column on the right axis; one far above along the axis.
  const packed = new Float32Array([
    ...centre,
    0.5,
    centre[0] + volumes[8] * (halfU + 1),
    centre[1] + volumes[9] * (halfU + 1),
    centre[2] + volumes[10] * (halfU + 1),
    0.5,
    centre[0] + volumes[4] * (halfDepth + 2),
    centre[1] + volumes[5] * (halfDepth + 2),
    centre[2] + volumes[6] * (halfDepth + 2),
    0.5,
    centre[0] + volumes[8] * (halfU + 1),
    centre[1] + volumes[9] * (halfU + 1),
    centre[2] + volumes[10] * (halfU + 1),
    1.5,
  ]);
  const lights = {
    cull: { volumes },
    spheres: { packed, rows: 4 },
    shadowRegions: 1,
  } as unknown as WebgpuLightState;
  const { tested, kept } = countShadowOccluders(lights, 4);
  assert.equal(tested, 4);
  // Inside; a metre past the column with half a metre of radius: dropped; past the depth: dropped;
  // a metre past with a metre and a half of radius: it reaches in, kept.
  assert.equal(kept, 2);
});
