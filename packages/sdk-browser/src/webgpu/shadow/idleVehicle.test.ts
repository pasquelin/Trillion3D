// #831: drive-a-car braked to a stop, 0 km/h, its engine still at 2,400 rpm. Jolt keeps a vehicle
// awake until its engine idles, and awake, the car shook 0.4 mm a step on its brakes for seven
// seconds: its body and wheels staled their shadow pages every frame. Parked, the engine idles
// (`vehicles.cpp`): the car sleeps, and its casters, followed as the engine follows a placement's
// rows (`placement/update.ts`), stale no page; driven, they do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOX_VALUES, boxTransform } from '../../../../sdk-core/src/index.ts';
import { CHASE, chaseSun } from '../../../../sdk-core/src/scene/light-shadow/chaseSun.fixture.ts';
import { planFrame } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts';
import { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { createPlacementRows, placementWorld } from '../../placement/rows.ts';
import { MOVE_NONE, followPlacementRows } from '../../placement/update.ts';
import { RELEASED, vehicleRig } from '../../physics/vehicles.fixture.ts';
import { createShadowMobility } from './mobility.ts';

test('a car braked to a stop, its engine revving, stales no shadow page over 120 frames; driven, it does', async () => {
  const rig = await vehicleRig('car'),
    parts = [rig.body, ...rig.wheels],
    rows = createPlacementRows(parts.length),
    body = new Matrix4(),
    wheel = new Matrix4(),
    at = new Vector3(),
    turn = new Quaternion(),
    one = new Vector3(1, 1, 1);
  /** Each part's world in its row, the body's from its last step, the wheels' on it. */
  const pose = () => {
    const [x, y, z] = rig.at(rig.body),
      [qx, qy, qz, qw] = rig.turn(rig.body);
    body.compose(at.set(x, y, z), turn.set(qx, qy, qz, qw), one);
    rows.matrices.set(body.elements, 0);
    rig.wheels.forEach((part, i) => {
      part.updateMatrix();
      rows.matrices.set(wheel.multiplyMatrices(body, part.matrix).elements, (i + 1) * 16);
    });
  };
  pose();
  const roots = parts.map((part, index) => {
    const { min, max } = part.localBounds()!,
      world = placementWorld(rows, index),
      localBox = Float64Array.of(min.x, min.y, min.z, max.x, max.y, max.z),
      worldBox = new Float64Array(BOX_VALUES);
    rows.live[index] = 1;
    boxTransform(worldBox, 0, localBox, 0, world.elements);
    return { pages: [], world, localBox, worldBox, placement: { rows, index } };
  });
  const mobility = createShadowMobility();
  mobility.ensure(roots.length, roots.length, (rank) => roots[rank].world.elements);
  const { store, plan } = chaseSun();
  let frame = 4;
  /** `steps` frames, each part's rows followed and weighed as the engine's
   *  (`placement/webgpuPlacements.ts`): the pages they staled. */
  const frames = (steps: number) => {
    let staled = 0;
    for (let s = 0; s < steps; s++) {
      rig.run(1);
      pose();
      followPlacementRows(
        roots as never,
        rows,
        0,
        parts.length - 1,
        undefined,
        (rank, world, forced) =>
          !forced && mobility.holds(rank, world, roots[rank].localBox)
            ? MOVE_NONE
            : mobility.move(rank, world, true),
        undefined,
        (min, max, movingOnly) => plan.worldChanged(min, max, movingOnly),
      );
      planFrame(plan, store, frame++, CHASE);
      plan.commit();
      staled += plan.counts.invalidatedPages;
    }
    return staled;
  };
  // The pedals are handed over when they change, as the keys do (`vehicleControls.ts`).
  rig.vehicle.drive({ ...RELEASED, throttle: 1 });
  assert.ok(frames(60) > 0, 'driven, the car stales its pages');
  rig.vehicle.drive({ ...RELEASED, brake: 1 });
  for (let s = 0; s < 300 && Math.abs(rig.vehicle.speed) > 0.05; s++) frames(1);
  assert.ok(rig.vehicle.rpm > 1500, `stopped at ${rig.vehicle.rpm} rpm, the engine revving`);
  rig.vehicle.drive(RELEASED);
  // It rocks on its springs a second and a half, then Jolt puts it to sleep: two seconds to settle
  // — its engine left to spin down took seven —, then nothing for 120 frames.
  frames(120);
  assert.equal(frames(120), 0, 'at rest, no page staled');
  assert.ok(Math.abs(rig.vehicle.speed) < 0.01);
});
