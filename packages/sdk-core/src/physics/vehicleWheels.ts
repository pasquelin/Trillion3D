import { Vector3 } from '../world/math/vector3.ts';
import type { Vehicle } from './vehicle.ts';
import { WHEEL_ROLE } from './vehicleLayout.ts';

const size = new Vector3();

/**
 * A vehicle's wheels as the VEHICLE command carries them (`WHEEL_WORDS` each: centre, radius,
 * width, role), in the body's own frame, read from the wheels as they stand now; and the lock of
 * its steered wheels, the angle its turning radius asks of its wheelbase (`VehicleSpec`). The
 * body faces −z: the wheels ahead of the middle of the wheelbase are the forward ones.
 */
export function wheelsOf({ kind, body, wheels, spec }: Vehicle) {
  const scale = body.scale;
  const placed = wheels.map((wheel) => {
    wheel.updateMatrix();
    // The vehicle refused a wheel without bounds (`vehicle.ts`).
    wheel.localBounds()!.clone().applyMatrix4(wheel.matrix).getSize(size).multiply(scale);
    const centre = wheel.position.clone().multiply(scale);
    return { x: centre.x, y: centre.y, z: centre.z, radius: size.y / 2, width: size.x };
  });
  const zs = placed.map((wheel) => wheel.z);
  const front = Math.min(...zs),
    rear = Math.max(...zs),
    middle = (front + rear) / 2;
  /** Per side, the rearmost wheel's z: a track's sprocket. */
  const sprocket = (x: number) =>
    Math.max(...placed.filter((w) => w.x < 0 === x < 0).map((w) => w.z));
  const drives = {
    front: (z: number) => z < middle,
    rear: (z: number) => z >= middle,
    all: () => true,
  };
  const roleOf = (x: number, z: number) => {
    if (kind === 'tracked') return z === sprocket(x) ? WHEEL_ROLE.sprocket : 0;
    const driven = kind === 'motorcycle' ? z >= middle : drives[spec.drive](z);
    const held = z < middle ? WHEEL_ROLE.steers : WHEEL_ROLE.handbrake;
    return held | (driven ? WHEEL_ROLE.driven : 0);
  };
  const words = placed.flatMap(({ x, y, z, radius, width }) => [
    x,
    y,
    z,
    radius,
    width,
    roleOf(x, z),
  ]);
  const maxSteer = Math.asin(Math.min(1, (rear - front) / spec.turnRadius));
  return { words, maxSteer };
}
