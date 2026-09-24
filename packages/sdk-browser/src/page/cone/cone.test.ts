import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { surfaceOf } from '../surface.ts';
import {
  OPEN_CONE,
  coneContextFor,
  coneCullsPage,
  coneCullsPageWith,
  createConeContext,
  triangleCone,
} from './cone.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';
import { leafCone } from '../../gpu/core/selection.ts';
import { coneSkipsPage } from '../selection/helpers.ts';

test('a single front-facing triangle has a narrow cone along +z', () => {
  const cone = triangleCone([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
  assert.ok(cone.angle < 1e-6);
  assert.ok(cone.axis[2] > 0.9);
});

test('opposite triangles produce an open cone', () => {
  const cone = triangleCone(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0],
    [0, 1, 2, 3, 4, 5],
  );
  assert.ok(cone.angle >= Math.PI / 2 - 1e-6);
});

test('OPEN_CONE never rejects', () => {
  const world = new G.Matrix4();
  const cam = G.perspectiveCamera(55, 1, 0.1, 100);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  assert.equal(
    coneCullsPage(OPEN_CONE, world, [-1, -1, 0], [1, 1, 0], cameraMoteur(cam).eye),
    false,
  );
});

test('a +z cone seen from behind the plane is rejected, and perspective spread keeps a grazing bound', () => {
  const cone = { axis: [0, 0, 1] as [number, number, number], angle: Math.PI / 6 };
  const world = new G.Matrix4();
  const behind = G.perspectiveCamera(55, 1, 0.1, 100);
  behind.position.set(0, 0, -5);
  behind.lookAt(0, 0, 0);
  behind.updateMatrixWorld();
  assert.equal(
    coneCullsPage(cone, world, [-0.1, -0.1, 0], [0.1, 0.1, 0], cameraMoteur(behind).eye),
    true,
  );
  const grazing = G.perspectiveCamera(55, 1, 0.1, 100);
  grazing.position.set(0, 0, 5);
  grazing.lookAt(0, 0, 0);
  grazing.updateMatrixWorld();
  assert.equal(
    coneCullsPage(cone, world, [-1, -1, 0], [1, 1, 0], cameraMoteur(grazing).eye),
    false,
  );
});

test('an anisotropic scale does not reject a still-visible cone member', () => {
  const cone = { axis: [0, 0, 1] as [number, number, number], angle: Math.PI / 4 };
  const world = new G.Matrix4().makeScale(0.1, 1, 1);
  const cam = G.perspectiveCamera(55, 1, 0.1, 200);
  cam.position.set(60, 0, -80);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const visible = new G.Vector3(1, 0, 1)
    .normalize()
    .applyMatrix3(new G.Matrix3().getNormalMatrix(world))
    .normalize();
  assert.ok(visible.dot(new G.Vector3().copy(cam.position).normalize()) > 0);
  assert.equal(
    coneCullsPage(cone, world, [-0.01, -0.01, -0.01], [0.01, 0.01, 0.01], cameraMoteur(cam).eye),
    false,
  );
});

test('BackSide materials are not cone-culled from behind', () => {
  const cone = { axis: [0, 0, 1] as [number, number, number], angle: Math.PI / 6 };
  const world = new G.Matrix4();
  const behind = G.perspectiveCamera(55, 1, 0.1, 100);
  behind.position.set(0, 0, -5);
  behind.lookAt(0, 0, 0);
  behind.updateMatrixWorld();
  const material = G.basicSurface({ side: G.BACK_SIDE });
  assert.equal(
    coneCullsPage(
      cone,
      world,
      [-0.1, -0.1, 0],
      [0.1, 0.1, 0],
      cameraMoteur(behind).eye,
      surfaceOf(material),
    ),
    false,
  );
  material.dispose();
});

test('the root context yields the same reject as the per-cluster compute, and is set only on demand', () => {
  const cone = { axis: [0, 0, 1] as [number, number, number], angle: Math.PI / 6 };
  const world = new G.Matrix4().makeRotationY(0.4).setPosition(2, 0, -1);
  const cam = G.perspectiveCamera(55, 1, 0.1, 100);
  cam.position.set(0, 0, -5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const ctx = createConeContext();
  assert.equal(ctx.ready, false, 'no root read until someone asks for a reject');
  coneContextFor(ctx, world, cameraMoteur(cam).eye);
  assert.equal(ctx.ready, true);
  for (const [min, max] of [
    [
      [-0.1, -0.1, 0],
      [0.1, 0.1, 0],
    ],
    [
      [-3, -3, -3],
      [3, 3, 3],
    ],
    [
      [1, 1, 1],
      [1.2, 1.4, 1.1],
    ],
  ])
    assert.equal(
      coneCullsPageWith(ctx, cone, world, min, max),
      coneCullsPage(cone, world, min, max, cameraMoteur(cam).eye),
      `box ${min} ${max}`,
    );
});

test('a surface switched to double-sided in place gets its page back at the cut', () => {
  const cone = { axis: [0, 0, 1] as [number, number, number], angle: Math.PI / 6 };
  const world = new G.Matrix4();
  const behind = G.perspectiveCamera(55, 1, 0.1, 100);
  behind.position.set(0, 0, -5);
  behind.lookAt(0, 0, 0);
  behind.updateMatrixWorld();
  const cam = cameraMoteur(behind);
  const min = [-0.1, -0.1, 0],
    max = [0.1, 0.1, 0];
  const material = G.basicSurface({ side: G.FRONT_SIDE });
  const surface = surfaceOf(material);
  assert.equal(coneCullsPage(cone, world, min, max, cam.eye, surface), true, 'front-only, behind');
  assert.equal(leafCone({ cone, material: surface }), cone);
  // The host opens the surface on the declaration it shares with its mesh: no version is bumped,
  // and nothing on this path refreshes the record.
  material.side = G.DOUBLE_SIDE;
  assert.equal(leafCone({ cone, material: surface }), OPEN_CONE, 'the cut reopens the cone');
  assert.equal(
    coneCullsPage(cone, world, min, max, cam.eye, surface),
    false,
    'the faces stay in the image',
  );
  assert.equal(
    coneSkipsPage({ cone, min, max, material: surface }, createConeContext(), world, cam, min, max),
    false,
  );
  material.dispose();
});
