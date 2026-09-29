// The same wave read by the physics and by the drawn surface (#357, #422): the GPU deformation
// stage's WGSL, run on the record the frame writes for a mesh the water surface carries, puts
// each rest point within a centimetre of where the physics' `WaterSurface.point` puts it, this
// frame and the last one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { DEFORM_WGSL } from './deformWgsl.ts';
import { createDeformationFrame } from './frame.ts';
import { deformedOf } from './source.ts';
import { recordLayout } from './layout.ts';
import { WaterSurface } from '../../../sdk-core/src/fluids/waterSurface.ts';

const WORLD = { elements: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) };

test('the drawn surface stands within a centimetre of the physics surface, now and a frame ago', () => {
  const surface = new WaterSurface({
    level: 0,
    waves: [
      { direction: [1, 0.3], wavelength: 12, amplitude: 0.4, steepness: 0.6 },
      { direction: [-0.2, 1], wavelength: 5, amplitude: 0.15, steepness: 0.5, phase: 1 },
      { direction: [0.7, -0.7], wavelength: 2.5, amplitude: 0.05, steepness: 0.4 },
    ],
  });
  const placed = deformedOf({ waves: surface }, undefined, WORLD)!;
  const frame = createDeformationFrame([placed]);
  surface.setTime(3.2);
  frame.update(() => false);
  surface.setTime(3.2 + 1 / 60);
  frame.update(() => false);
  const at = frame.bases[0] - 1 + recordLayout(placed.shape).wave;
  const { deformWaves } = shaderRun<{
    deformWaves: (
      at: number,
      count: number,
      p: number[],
      previous: boolean,
      normal: boolean,
    ) => number[];
  }>(DEFORM_WGSL, ['deformWaves'], { positions: frame.block, cos: Math.cos });
  const expected = new Float64Array(3);
  let worst = 0;
  for (const [time, previous] of [
    [3.2 + 1 / 60, false],
    [3.2, true],
  ] as const) {
    surface.setTime(time);
    for (let x = -40; x <= 40; x += 3.7)
      for (let z = -25; z <= 25; z += 2.9) {
        const d = deformWaves(at, 3, [x, 0, z], previous, false);
        surface.point(x, z, expected);
        worst = Math.max(
          worst,
          Math.hypot(x + d[0] - expected[0], d[1] - expected[1], z + d[2] - expected[2]),
        );
      }
  }
  assert.ok(worst < 0.01, `${worst} m apart`);
});
