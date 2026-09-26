import type { Engine, Families, Mesh, Vec3 } from './engineTypes.ts';
import { vehicleParts, type Hulled } from './vehicleParts.ts';

type World = Pick<Engine.World, 'camera' | 'raycast'>;

/** A vehicle built: its body and collision shape, mass, wheels and their radius, where the
 *  camera chases it from (`eye`, in the body's frame) and how high above its centre it looks
 *  (`aim`), and the driver `world.controls.vehicle` takes and `world.physics` simulates. */
export interface BuiltVehicle extends Hulled {
  mass: number;
  radius: number;
  wheels: Mesh[];
  eye: Vec3;
  aim: number;
  driver: Engine.Vehicle;
}

/** How long a vehicle waits for the ground below it to stream into the physics, in ms, trying
 *  again every `GROUND_RETRY` ms: long past what a page's terrain takes, short of a page that
 *  seems to hang. */
const GROUND_WAIT = 30_000,
  GROUND_RETRY = 100;

/**
 * Vehicles on Jolt's own vehicle constraint: `car`, `motorcycle` and `tracked` build a sports
 * car, a motorcycle and a tank, each a body on wheels (`vehicle.car`, `.motorcycle`,
 * `.tracked`). The page adds each to its scene and physics once `park` has set it on the ground
 * at `[x, z]`, found by an exact raycast down from `above` (a height over all the ground).
 * `right` puts one back on its wheels where it stands; `chase` eases the camera behind one;
 * `groundAt` is the height of that ground below `[x, z]`, for a page placing more on it.
 */
export function vehicles(
  world: World,
  engine: Families<'geometry' | 'material' | 'object' | 'math' | 'vehicle'>,
  { above }: { above: number },
) {
  const { math, vehicle } = engine;
  const { chassis, block, solid, wheel, paint, glow, tyre } = vehicleParts(engine);

  // The sports car, 1,470 kg: the C5 Corvette the engine's car is drawn from.
  const car = (): BuiltVehicle => {
    const built = chassis([1.86, 0.45, 4.5], '#c8102e'),
      radius = 0.33;
    block(
      built,
      [1.4, 0.42, 1.9],
      paint('#15191f', { roughness: 0.1, metalness: 0.6 }),
      [0, 0.43, 0.25],
    );
    block(built, [1.7, 0.06, 0.3], paint('#15191f'), [0, 0.4, 2.15]);
    for (const x of [-0.65, 0.65]) {
      block(built, [0.35, 0.1, 0.05], glow('#fff4d6'), [x, 0.05, -2.26]);
      block(built, [0.35, 0.1, 0.05], glow('#ff2a2a'), [x, 0.08, 2.26]);
    }
    const wheels = [-1.35, 1.35].flatMap((z) =>
      [-0.8, 0.8].map((x) => wheel(built, [x, -0.2, z], radius, 0.26)),
    );
    const driver = vehicle.car(built.body, { wheels });
    return { ...built, mass: 1470, radius, wheels, eye: [0, 2.4, 7.5], aim: 0.8, driver };
  };

  // The motorcycle and its rider, 319 kg together.
  const motorcycle = (): BuiltVehicle => {
    const built = chassis([0.34, 0.45, 1.3], '#1f4fd1'),
      radius = 0.31;
    block(built, [0.4, 0.22, 0.55], paint('#1f4fd1'), [0, 0.32, -0.2]);
    block(built, [0.7, 0.05, 0.05], paint('#2b303a'), [0, 0.62, -0.55]);
    block(built, [0.4, 0.62, 0.3], paint('#2b2f36'), [0, 0.72, 0.2], [-0.35, 0, 0]);
    solid(built, { type: 'sphere', radius: 0.16 }, paint('#f2c14e'), [0, 1.15, 0.05]);
    block(built, [0.12, 0.08, 0.05], glow('#fff4d6'), [0, 0.25, -0.67]);
    const wheels = [-0.72, 0.72].map((z) => wheel(built, [0, -0.3, z], radius, 0.14));
    const driver = vehicle.motorcycle(built.body, { wheels });
    return { ...built, mass: 319, radius, wheels, eye: [0, 1.8, 5], aim: 0.8, driver };
  };

  // The tank, 61 t: an M1 Abrams' hull, turret and gun, on six road wheels a side.
  const tracked = (): BuiltVehicle => {
    const built = chassis([3.6, 1, 7], '#5b6b3a'),
      radius = 0.42;
    block(built, [2.6, 0.7, 3.2], paint('#56663a'), [0, 0.85, 0.3]);
    solid(
      built,
      { type: 'cylinder', radius: 0.12, radiusBottom: 0.14, halfHeight: 2.25 },
      paint('#4a5630'),
      [0, 0.9, -3.5],
      [Math.PI / 2, 0, 0],
    );
    for (const x of [-1.55, 1.55]) block(built, [0.62, 0.12, 7.2], tyre, [x, -0.05, 0]);
    const wheels = [-2.75, -1.65, -0.55, 0.55, 1.65, 2.75].flatMap((z) =>
      [-1.55, 1.55].map((x) => wheel(built, [x, -0.6, z], radius, 0.6)),
    );
    const driver = vehicle.tracked(built.body, { wheels });
    return { ...built, mass: 61300, radius, wheels, eye: [0, 5.5, 15], aim: 1.5, driver };
  };

  // The ground below `[x, z]`, once the physics has streamed it in, through `ignore` if given.
  const groundAt = async (x: number, z: number, ignore?: Mesh) => {
    const down = math.ray(math.vector3(x, above, z), math.vector3(0, -1, 0));
    // A deadline, not a count of tries: each raycast's own round trip counts against the wait.
    for (const deadline = Date.now() + GROUND_WAIT; ;) {
      const hit = await world.raycast(down, { exact: true, ignore });
      if (hit) return hit.point.y;
      if (Date.now() >= deadline)
        throw new Error(
          `No ground below [${x}, ${z}] from ${above} m after ${GROUND_WAIT / 1000} s`,
        );
      await new Promise((wait) => setTimeout(wait, GROUND_RETRY));
    }
  };
  // Parked at `[x, z]`: set a little above what the ray meets there, level, facing `yaw`, and
  // simulated anew (setting `physics` again makes the body, and the vehicle with it, afresh).
  const park = async (built: BuiltVehicle, [x, z]: [number, number], yaw = 0) => {
    const { body, hull, mass, radius, wheels } = built;
    body.position.set(x, (await groundAt(x, z, body)) + radius - wheels[0].position.y + 0.3, z);
    body.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    body.physics = { mass, shape: { type: 'compound', parts: hull } };
  };
  // Put back on its wheels, a vehicle stays where it stands, never on a start another may have
  // driven to since.
  const heading = math.vector3();
  const right = (built: BuiltVehicle) => {
    const { position, quaternion } = built.body;
    heading.set(0, 0, -1).applyQuaternion(quaternion);
    return park(built, [position.x, position.z], Math.atan2(-heading.x, -heading.z));
  };

  // The camera follows from behind, eased so a bump never shakes it.
  const eye = math.vector3(),
    aim = math.vector3();
  const chase = (built: BuiltVehicle, delta: number) => {
    const { body } = built;
    eye
      .set(...built.eye)
      .applyQuaternion(body.quaternion)
      .add(body.position);
    eye.y = Math.max(eye.y, body.position.y + 1);
    world.camera.position.lerp(eye, 1 - Math.exp(-delta * 5));
    aim.copy(body.position);
    aim.y += built.aim;
    world.camera.lookAt(aim);
  };
  return { car, motorcycle, tracked, park, right, chase, groundAt };
}
