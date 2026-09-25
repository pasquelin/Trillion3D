import {
  vehicle,
  type VehicleInput,
  type VehicleKind,
  type VehicleOptions,
} from '../../../sdk-core/src/physics/index.ts';
import { box, cylinder } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { jointRig } from './joints.fixture.ts';

/** Each kind's body — size, mass, wheels `[x, y, z]` from its centre, wheel radius and width —
 *  drawn from the machines of `VEHICLE_SPECS`. */
const MACHINES: Record<
  VehicleKind,
  {
    size: [number, number, number];
    mass: number;
    wheels: number[][];
    radius: number;
    width: number;
  }
> = {
  car: {
    size: [1.8, 0.5, 4.4],
    mass: 1470,
    wheels: [-1, 1].flatMap((z) => [-0.8, 0.8].map((x) => [x, -0.3, z * 1.33])),
    radius: 0.33,
    width: 0.25,
  },
  motorcycle: {
    size: [0.4, 0.6, 1.5],
    mass: 319,
    wheels: [-0.75, 0.75].map((z) => [0, -0.35, z]),
    radius: 0.31,
    width: 0.12,
  },
  tracked: {
    size: [3.4, 1, 6.4],
    mass: 61300,
    wheels: [-2.4, -1.2, 0, 1.2, 2.4].flatMap((z) => [-1.5, 1.5].map((x) => [x, -0.6, z])),
    radius: 0.4,
    width: 0.6,
  },
};

/** The released pedals and wheel. */
const RELEASED: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

/**
 * A rig on flat stone 2 km wide, with one vehicle of `kind` resting on its wheels at the middle,
 * facing −z. `options` goes over its spec.
 */
export async function vehicleRig(kind: VehicleKind, options: Partial<VehicleOptions> = {}) {
  const rig = await jointRig();
  const ground = new Mesh(box(2000, 1, 2000), new Material('meshStandard', { physics: 'stone' }));
  ground.position.set(0, -0.5, 0);
  ground.physics = 'static';
  const machine = MACHINES[kind];
  const body = new Mesh(box(...machine.size), new Material('meshStandard'));
  body.physics = { mass: machine.mass };
  body.position.set(0, machine.radius - machine.wheels[0][1], 0);
  const wheels = machine.wheels.map(([x, y, z]) => {
    const wheel = new Mesh(
      cylinder(machine.radius, machine.radius, machine.width),
      new Material('meshStandard'),
    );
    wheel.position.set(x, y, z);
    wheel.rotation.z = Math.PI / 2;
    body.add(wheel);
    return wheel;
  });
  rig.scene.add(ground, body);
  const driven = vehicle[kind](body, { wheels, ...options });
  rig.driven.add(driven);
  rig.run(90);
  return {
    ...rig,
    body,
    wheels,
    /** Where each wheel was placed on the body. */
    placed: machine.wheels,
    vehicle: driven,
    /** Drives with `input` for `seconds`. */
    hold(input: Partial<VehicleInput>, seconds: number) {
      driven.drive({ ...RELEASED, ...input });
      rig.run(Math.round(seconds * 60));
    },
    /** The body's roll about its forward axis, radians: its right side's rise. */
    roll() {
      const [x, y, z, w] = rig.turn(body);
      return Math.asin(2 * (x * y + w * z));
    },
    /** Steers with `input` for `seconds`: the turn's lateral acceleration `v × yaw rate` over g,
     *  as a lean `atan(a / g)`, radians. */
    turning(input: Partial<VehicleInput>, seconds: number) {
      const yaw = rig.yaw(body);
      driven.drive({ ...RELEASED, ...input });
      rig.run(Math.round(seconds * 60));
      const turned = Math.abs(
        Math.atan2(Math.sin(rig.yaw(body) - yaw), Math.cos(rig.yaw(body) - yaw)),
      );
      return Math.atan((driven.speed * turned) / seconds / 9.81);
    },
    /** How far the body's up leans from the world's, radians. */
    tilt() {
      const [x, , z] = rig.turn(body);
      return 2 * Math.asin(Math.min(1, Math.hypot(x, z)));
    },
  };
}
