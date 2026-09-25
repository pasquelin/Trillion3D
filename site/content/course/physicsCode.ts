import type { ChapterCode } from './code.ts';

/** The course's physics chapters, in order: falling bodies, the character among them, joints
 *  and vehicles. */
export const PHYSICS_CHAPTERS: ChapterCode[] = [
  {
    id: 'make-things-fall',
    example: 'falling-boxes',
    code: [
      `const world = createWorld('view', { controls: 'orbit', physics: true });

const floor = object.mesh(geometry.box(40, 1, 40), material.meshStandard({ physics: 'stone' }));
floor.physics = 'static'; // holds the others, never moves
world.scene.add(floor);

const wood = material.meshStandard({ color: '#c08a4d', physics: 'wood' });
const box = object.mesh(geometry.box(1, 1, 1), wood);
box.position.y = 6;
box.physics = 'dynamic'; // gravity pulls it; its shape is the box, its mass the wood's
world.scene.add(box);

box.physics.on('contact', ({ impulse }) => console.log('bump', impulse));
world.physics.gravity = 'moon'; // or 'earth', 'mars', 'none'`,
    ],
  },
  {
    id: 'touch-and-react',
    example: 'walk-with-collisions',
    code: [
      `const world = createWorld('view', { controls: 'character', physics: true });

floor.physics = 'static'; // the ground, the stairs, the walls: they never move
platform.physics = 'kinematic'; // moved by your code, it carries what stands on it
box.physics = { type: 'dynamic', mass: 12 }; // light enough to push

let phase = 0;
world.beforeFrame(({ delta }) => {
  platform.position.x = Math.sin((phase += delta * 0.5)) * 4;
  world.invalidate();
});
world.controls.pushStrength = 400; // newtons: push harder`,
    ],
  },
  {
    id: 'connect-drive-and-break',
    example: 'hinges-and-joints',
    code: [
      `// A door on a hinge along its edge, pushed open by its motor.
const hinge = joint.hinge(door, frame, {
  anchor: [-0.6, 1, 0], // where the pin is, in the world
  axis: [0, 1, 0], // the pin points up
  limits: { min: 0, max: 1.6 }, // radians
  motor: { mode: 'position', target: 0, maxForce: 600 },
});
world.physics.add(hinge);
hinge.motor = { mode: 'position', target: 1.5, maxForce: 600 }; // open it

// A drawer on a rail, a chain link to the ceiling (null is the world), a plank that breaks.
world.physics.add(joint.slider(drawer, cabinet, { axis: [0, 0, 1], limits: { min: 0, max: 0.7 } }));
world.physics.add(joint.point(link, null, { anchor: [0, 5, 0] }));
const plank = joint.hinge(board, next, { anchor: [1, 2, 0], axis: [0, 0, 1], breakForce: 12000 });
plank.on('break', () => console.log('snap!'));
world.physics.add(plank);`,
      `// Tie motions together: each wheel on its own hinge, then the joints that mesh them.
world.physics.add(joint.hinge(small, null, { axis: [0, 0, 1], motor: { mode: 'velocity', target: 1 } }));
world.physics.add(joint.hinge(big, null, { axis: [0, 0, 1] }));
world.physics.add(joint.gear(small, big, { axis: [0, 0, 1], ratio: 12 / 36 })); // teeth over teeth
world.physics.add(joint.hinge(pinion, null, { axis: [0, 0, 1] }));
world.physics.add(joint.slider(rack, null, { axis: [0, 1, 0] }));
world.physics.add(joint.rackAndPinion(pinion, rack, { axis: [0, 0, 1], axisB: [0, 1, 0], ratio: 1 / 0.5 }));

// A rope over two wheels, a cart on a looped track, a shoulder that swings and twists.
world.physics.add(joint.pulley(bucket, weight, { over: [[6, 8, 0], [9, 8, 0]] }));
world.physics.add(joint.path(cart, null, { path: trackPoints, loop: true }));
world.physics.add(joint.swingTwist(arm, body, { axis: [1, 0, 0], limits: { swing: 0.8, min: -0.5, max: 0.5 } }));`,
      `// A car: a body, and four wheel meshes on it where they rest; it faces −z.
const car = object.mesh(geometry.box(1.8, 0.45, 4.4), material.meshStandard({ color: '#c8102e' }));
car.physics = { mass: 1470 };
const wheels = [-1.35, 1.35].flatMap((z) => [-0.8, 0.8].map((x) => {
  const wheel = object.mesh(geometry.cylinder(0.33, 0.33, 0.26), material.meshStandard({ color: '#222' }));
  wheel.position.set(x, -0.2, z);
  wheel.rotation.z = Math.PI / 2; // its axle along x
  car.add(wheel);
  return wheel;
}));
world.scene.add(car);

const driven = vehicle.car(car, { wheels }); // or vehicle.motorcycle, vehicle.tracked
world.physics.add(driven);
world.controls.vehicle = driven; // W S A D and Space drive it
world.controls.kind = 'vehicle';
world.onFrame(() => console.log(driven.speed, driven.gear, driven.rpm));`,
    ],
  },
];
