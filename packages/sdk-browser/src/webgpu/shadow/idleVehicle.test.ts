// #831: drive-a-car braked to a stop, 0 km/h, its engine still at 2,400 rpm. Jolt keeps a vehicle
// awake until its engine idles, and awake, the car shook 0.4 mm a step on its brakes for seven
// seconds: its body and wheels staled their shadow pages every frame. Parked, the engine idles
// (`vehicles.cpp`): the car sleeps, and its casters, weighed as the engine weighs a placement's
// pose (`mobility.ts`), stale no page; driven, they do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boxTransform } from '../../../../sdk-core/src/math/primitives/box.ts';
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts';
import { createShadowPlan } from '../../../../sdk-core/src/scene/light-shadow/plan.ts';
import { shadowPoolSide } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import {
  SUN,
  VIEW,
  cycle,
  planFrame,
  sunPages,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts';
import { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { MOVE_MOVING } from '../../placement/update.ts';
import { flatRig, placeVehicle, RELEASED } from '../../physics/vehicles.fixture.ts';
import { createShadowMobility } from './mobility.ts';

/** The example's chase camera, behind the car and up, and its sun, every page around it drawn. */
const CHASE = { ...VIEW, position: [0, 2.4, 7.5] as const };
function sunAround() {
  const store = createSceneLightStore(),
    plan = createShadowPlan(shadowPoolSide(960, 600));
  store.add({ ...SUN, direction: [-40, -70, -25].map((a) => a / Math.hypot(40, 70, 25)) as never });
  let read: number[] = [];
  cycle(plan, store, 0, () => read, CHASE);
  const slice = store.sliceOf(0),
    around = (n: number) =>
      Array.from({ length: n * n }, (_, i) => [(i % n) - n / 2, ((i / n) | 0) - n / 2]);
  read = [5, 6, 7, 8].flatMap((step, i) =>
    sunPages(plan, slice, plan.sun.finest[slice] + step, around([24, 16, 16, 8][i])),
  );
  for (let frame = 1; frame < 4; frame++) cycle(plan, store, frame, () => read, CHASE);
  return { store, plan, read };
}

test('a car braked to a stop, its engine revving, stales no shadow page over 120 frames; driven, it does', async () => {
  const rig = await flatRig(),
    car = placeVehicle(rig, 'car'),
    parts = [car.body, ...car.wheels];
  rig.run(120);
  const bodyWorld = new Matrix4(),
    worlds = parts.map(() => new Matrix4()),
    boxes = parts.map((part) => {
      const { min, max } = part.localBounds()!;
      return [min.x, min.y, min.z, max.x, max.y, max.z];
    });
  /** Each part's world, the body's from its last step, the wheels' on it. */
  const pose = () => {
    const [qx, qy, qz, qw] = rig.turn(car.body);
    bodyWorld.compose(
      new Vector3(...rig.at(car.body)),
      new Quaternion(qx, qy, qz, qw),
      new Vector3(1, 1, 1),
    );
    worlds[0].copy(bodyWorld);
    car.wheels.forEach((wheel, i) => {
      wheel.updateMatrix();
      worlds[i + 1].multiplyMatrices(bodyWorld, wheel.matrix);
    });
    return worlds.map((world) => world.elements);
  };
  const mobility = createShadowMobility();
  mobility.ensure(parts.length, parts.length, (rank) => pose()[rank]);
  const { store, plan } = sunAround(),
    moved = new Float64Array(6);
  let frame = 4;
  /** `steps` frames, each part's pose weighed as the engine weighs a placement's
   *  (`placement/webgpuPlacements.ts`): the pages they staled. */
  const frames = (steps: number) => {
    let staled = 0;
    for (let s = 0; s < steps; s++) {
      rig.run(1);
      pose().forEach((world, rank) => {
        if (mobility.holds(rank, world, boxes[rank])) return;
        const kind = mobility.move(rank, world, true);
        boxTransform(moved, 0, boxes[rank], 0, world);
        plan.worldChanged(moved.subarray(0, 3), moved.subarray(3, 6), kind === MOVE_MOVING);
      });
      planFrame(plan, store, frame++, CHASE);
      plan.commit();
      staled += plan.counts.invalidatedPages;
    }
    return staled;
  };
  // The pedals are handed over when they change, as the keys do (`vehicleControls.ts`).
  car.vehicle.drive({ ...RELEASED, throttle: 1 });
  assert.ok(frames(60) > 0, 'driven, the car stales its pages');
  car.vehicle.drive({ ...RELEASED, brake: 1 });
  for (let s = 0; s < 300 && Math.abs(car.vehicle.speed) > 0.05; s++) frames(1);
  assert.ok(car.vehicle.rpm > 1500, `stopped at ${car.vehicle.rpm} rpm, the engine revving`);
  car.vehicle.drive(RELEASED);
  // It rocks on its springs a second and a half, then Jolt puts it to sleep: two seconds to settle
  // — its engine left to spin down took seven —, then nothing for 120 frames.
  frames(120);
  assert.equal(frames(120), 0, 'at rest, no page staled');
  assert.ok(Math.abs(car.vehicle.speed) < 0.01);
});
