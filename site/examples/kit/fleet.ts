import type * as Engine from '../../../packages/sdk-browser/src/index.ts';
import { fleetBuilder } from './fleetParts.ts';

type Families = Pick<typeof Engine, 'geometry' | 'material' | 'object' | 'math' | 'vehicle'>;
type Mesh = ReturnType<Families['object']['mesh']>;
type World = Pick<Engine.World, 'camera' | 'physics' | 'raycast' | 'scene'>;

/** One vehicle of the fleet: its body, mass, wheels and their radius, the spot it starts on, and
 *  the driver `world.controls.vehicle` takes. */
export interface FleetVehicle {
  body: Mesh;
  mass: number;
  radius: number;
  wheels: Mesh[];
  start: [number, number];
  driver: Engine.Vehicle;
}

/**
 * A sports car, a motorcycle and a tank, each a body on wheels on Jolt's own vehicle constraint
 * (`vehicle.car`, `vehicle.motorcycle`, `vehicle.tracked`): built, parked on the ground below its
 * start and added to the world and its physics. `right` puts one back on its wheels where it
 * stands; `chase` eases the camera behind one, each frame.
 */
export async function fleet(world: World, engine: Families) {
  const { math, vehicle } = engine;
  const { chassis, block, solid, wheel, hulls, paint, glow, tyre } = fleetBuilder(engine);

  // The sports car, 1,470 kg: the C5 Corvette the engine's car is drawn from.
  const car = chassis([1.86, 0.45, 4.5], '#c8102e');
  block(
    car,
    [1.4, 0.42, 1.9],
    paint('#15191f', { roughness: 0.1, metalness: 0.6 }),
    [0, 0.43, 0.25],
  );
  block(car, [1.7, 0.06, 0.3], paint('#15191f'), [0, 0.4, 2.15]);
  for (const x of [-0.65, 0.65]) {
    block(car, [0.35, 0.1, 0.05], glow('#fff4d6'), [x, 0.05, -2.26]);
    block(car, [0.35, 0.1, 0.05], glow('#ff2a2a'), [x, 0.08, 2.26]);
  }
  const carWheels = [-1.35, 1.35].flatMap((z) =>
    [-0.8, 0.8].map((x) => wheel(car, [x, -0.2, z], 0.33, 0.26)),
  );

  // The motorcycle and its rider, 319 kg together.
  const bike = chassis([0.34, 0.45, 1.3], '#1f4fd1');
  block(bike, [0.4, 0.22, 0.55], paint('#1f4fd1'), [0, 0.32, -0.2]);
  block(bike, [0.7, 0.05, 0.05], paint('#2b303a'), [0, 0.62, -0.55]);
  block(bike, [0.4, 0.62, 0.3], paint('#2b2f36'), [0, 0.72, 0.2], [-0.35, 0, 0]);
  solid(bike, { type: 'sphere', radius: 0.16 }, paint('#f2c14e'), [0, 1.15, 0.05]);
  block(bike, [0.12, 0.08, 0.05], glow('#fff4d6'), [0, 0.25, -0.67]);
  const bikeWheels = [-0.72, 0.72].map((z) => wheel(bike, [0, -0.3, z], 0.31, 0.14));

  // The tank, 61 t: an M1 Abrams' hull, turret and gun, on six road wheels a side.
  const tank = chassis([3.6, 1, 7], '#5b6b3a');
  block(tank, [2.6, 0.7, 3.2], paint('#56663a'), [0, 0.85, 0.3]);
  solid(
    tank,
    { type: 'cylinder', radius: 0.12, radiusBottom: 0.14, halfHeight: 2.25 },
    paint('#4a5630'),
    [0, 0.9, -3.5],
    [Math.PI / 2, 0, 0],
  );
  for (const x of [-1.55, 1.55]) block(tank, [0.62, 0.12, 7.2], tyre, [x, -0.05, 0]);
  const tankWheels = [-2.75, -1.65, -0.55, 0.55, 1.65, 2.75].flatMap((z) =>
    [-1.55, 1.55].map((x) => wheel(tank, [x, -0.6, z], 0.42, 0.6)),
  );

  const drive = (body: Mesh, wheels: Mesh[], make: typeof vehicle.car) => ({
    body,
    wheels,
    driver: make(body, { wheels }),
  });
  const vehicles: Record<Engine.VehicleKind, FleetVehicle> = {
    car: { ...drive(car, carWheels, vehicle.car), mass: 1470, radius: 0.33, start: [0, 20] },
    motorcycle: {
      ...drive(bike, bikeWheels, vehicle.motorcycle),
      mass: 319,
      radius: 0.31,
      start: [-8, 22],
    },
    tracked: {
      ...drive(tank, tankWheels, vehicle.tracked),
      mass: 61300,
      radius: 0.42,
      start: [12, 28],
    },
  };

  // Each starts on the ground below its spot, found by an exact raycast on the cooked valley
  // once the physics has streamed it in, through the vehicle's own body.
  const groundAt = async (x: number, z: number, ignore: Mesh) => {
    const down = math.ray(math.vector3(x, 60, z), math.vector3(0, -1, 0));
    for (;;) {
      const hit = await world.raycast(down, { exact: true, ignore });
      if (hit) return hit.point.y;
      await new Promise((wait) => setTimeout(wait, 100));
    }
  };
  // Parked at `[x, z]`: set a little above what the ray meets there, level, facing `yaw`, and
  // simulated anew (setting `physics` again makes the body, and the vehicle with it, afresh).
  // Put back on its wheels, a vehicle stays where it stands, never on its start another may
  // have driven to since.
  const park = async (entry: FleetVehicle, [x, z]: [number, number], yaw = 0) => {
    const { body, mass, radius, wheels } = entry;
    body.position.set(x, (await groundAt(x, z, body)) + radius - wheels[0].position.y + 0.3, z);
    body.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    body.physics = { mass, shape: { type: 'compound', parts: hulls.get(body) ?? [] } };
  };
  const heading = math.vector3();
  const right = (entry: FleetVehicle) => {
    const { position, quaternion } = entry.body;
    heading.set(0, 0, -1).applyQuaternion(quaternion);
    return park(entry, [position.x, position.z], Math.atan2(-heading.x, -heading.z));
  };
  for (const entry of Object.values(vehicles)) {
    await park(entry, entry.start);
    world.scene.add(entry.body);
    world.physics.add(entry.driver);
  }

  // The camera follows from behind, eased so a bump never shakes it.
  const behind: Record<Engine.VehicleKind, [number, number, number]> = {
    car: [0, 2.4, 7.5],
    motorcycle: [0, 1.8, 5],
    tracked: [0, 5.5, 15],
  };
  const eye = math.vector3(),
    aim = math.vector3();
  const chase = ({ body, driver }: FleetVehicle, delta: number) => {
    const kind = driver.kind;
    eye
      .set(...behind[kind])
      .applyQuaternion(body.quaternion)
      .add(body.position);
    eye.y = Math.max(eye.y, body.position.y + 1);
    const ease = 1 - Math.exp(-delta * 5);
    world.camera.position.lerp(eye, ease);
    aim.copy(body.position);
    aim.y += kind === 'tracked' ? 1.5 : 0.8;
    world.camera.lookAt(aim);
  };
  return { vehicles, right, chase };
}
