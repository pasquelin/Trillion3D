import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeformationFrame } from './frame.ts';
import { deformedOf } from './source.ts';
import { recordLayout } from './layout.ts';
import { DEFORM_WGSL } from './deformWgsl.ts';
import { DEFORM_GLSL } from './deformGlsl.ts';
import { waveShader } from './waves.fixture.ts';
import { WaterSurface } from '../../../sdk-core/src/fluids/waterSurface.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import { Quaternion } from '../../../sdk-core/src/world/math/quaternion.ts';
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts';
import { transformAffinePoint } from '../../../sdk-core/src/index.ts';
import { createWebglDeformation } from './webglFrame.ts';
import type { ClusterRoot, PageRec } from '../page/selection/selection.ts';
import type { EngineCamera } from '../camera/world.ts';

const surface = () =>
  new WaterSurface({
    level: 0,
    waves: [{ direction: [1, 0.3], wavelength: 4, amplitude: 1, steepness: 0.4 }],
  });

test('fixed-clock translation/rotation and moving-clock controls preserve complete wave history', () => {
  const water = surface(),
    world = new Matrix4();
  const placed = deformedOf({ waves: water }, undefined, world)!;
  const frame = createDeformationFrame([placed]),
    layout = recordLayout(placed.shape);
  frame.update(() => false);
  assert.equal(
    frame.update(() => false),
    false,
  );
  const deformWaves = waveShader(frame.block);
  const rest = [0.7, 0, 1.3];
  const drawnWorld = (previous: boolean, pose: Matrix4) => {
    const matrix = layout.world + (previous ? 32 : 0),
      at = new Float64Array(3),
      local = new Float64Array(3);
    transformAffinePoint(
      at,
      frame.block.subarray(matrix, matrix + 16),
      ...(rest as [number, number, number]),
    );
    const delta = deformWaves(layout.wave, 1, [...at], previous, false);
    transformAffinePoint(
      local,
      frame.block.subarray(matrix + 16, matrix + 32),
      at[0] + delta[0],
      at[1] + delta[1],
      at[2] + delta[2],
    );
    transformAffinePoint(at, pose.elements, local[0], local[1], local[2]);
    return [...at];
  };
  let before = world.clone(),
    previousDraw = drawnWorld(false, world);
  for (const update of [
    () => {
      world.elements[12] = 1;
    },
    () => {
      world.compose(
        new Vector3(1, 0, 0),
        new Quaternion(0, Math.sin(0.4), 0, Math.cos(0.4)),
        new Vector3(1, 1, 1),
      );
    },
    () => {
      water.setTime(0.3);
      water.waveModel.amplitude[0] = 0.5;
    },
  ]) {
    update();
    assert.equal(frame.pending(), true);
    assert.equal(
      frame.update(() => false),
      true,
    );
    assert.equal(frame.moving[0], 1);
    const prior = drawnWorld(true, before);
    assert.ok(Math.hypot(...prior.map((value, i) => value - previousDraw[i])) < 1e-6);
    const point = new Float64Array(3),
      expected = new Float64Array(3);
    transformAffinePoint(point, world.elements, ...(rest as [number, number, number]));
    water.point(point[0], point[2], expected);
    const current = drawnWorld(false, world);
    assert.ok(Math.hypot(...current.map((value, i) => value - expected[i])) < 1e-6);
    previousDraw = current;
    before = world.clone();
    assert.equal(
      frame.update(() => false),
      true,
      'previous GPU state settles once',
    );
    assert.equal(
      frame.update(() => false),
      false,
    );
  }
  assert.match(DEFORM_WGSL, /a\.world\+=select\(0u,32u,previous\)/);
  assert.match(DEFORM_GLSL, /deformWaves\(world\+64,waves/);
});

test('WebGL wave records advance their upload version when only the world transform changes', () => {
  const water = surface(),
    world = { elements: new Matrix4().elements };
  const roots = [
    { world, pages: [{ sourceMesh: { waves: water } }] },
  ] as unknown as ClusterRoot<PageRec>[];
  const deformation = createWebglDeformation(roots);
  const camera = { projection: new Matrix4().elements } as EngineCamera;
  deformation.update(camera, undefined, 0);
  const first = deformation.source()!.version;
  deformation.update(camera, undefined, 0);
  assert.equal(deformation.source()!.version, first);
  world.elements[12] = 2;
  deformation.update(camera, undefined, 0);
  assert.equal(deformation.source()!.version, first + 1);
  const at = recordLayout({ joints: 0, targets: 0, waves: 1 }).world;
  assert.equal(deformation.source()!.block[at + 12], 2);
  assert.equal(deformation.source()!.block[at + 32 + 12], 0);
  deformation.update(camera, undefined, 0);
  assert.equal(deformation.source()!.version, first + 2);
  assert.equal(deformation.source()!.block[at + 32 + 12], 2);
  deformation.update(camera, undefined, 0);
  assert.equal(deformation.source()!.version, first + 2);
});
