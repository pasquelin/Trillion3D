import { PHYSICS_CHAPTERS } from './physicsCode.ts';

/**
 * The course, in order: each chapter names the example that shows its result and the few lines
 * of code it teaches. The words around them, per language, are in `course.ts` and its French
 * overlay; the code is the same in every language.
 */
export interface ChapterCode {
  id: string;
  /** The ready example (`site/examples/<example>.html`) the chapter shows live. */
  example: string;
  /** One or more short blocks: a terminal command, then the page's code, for instance. */
  code: string[];
}

export const CHAPTERS: ChapterCode[] = [
  {
    id: 'create-a-world',
    example: 'a-first-world',
    code: [
      `pnpm add ../Trillion3D   # the folder where you cloned and built the engine`,
      `<canvas id="view" style="width: 100%; height: 400px"></canvas>`,
      `import { createWorld, geometry, material, object, light } from 'trillion3d';

const world = createWorld('view', { controls: 'orbit' });
const cube = object.mesh(geometry.box(1, 1, 1), material.meshStandard({ color: '#3c8ce0' }));
cube.position.set(0, 0.5, 0);
world.scene.add(cube);
world.scene.add(light.directional({ intensity: 3, position: [3, 5, 4], castShadow: true }));
world.scene.add(light.hemisphere({ color: '#bcd4ff', groundColor: '#5a4a3c', intensity: 1 }));
world.camera.position.set(2.2, 1.8, 3.2);
world.camera.lookAt(0, 0.4, 0);`,
    ],
  },
  {
    id: 'add-a-shape',
    example: 'shapes-on-a-turntable',
    code: [
      `const paint = material.meshStandard({ color: '#e0663c' });
const ball = object.mesh(geometry.sphere(0.75, 64, 32), paint);
ball.position.set(0, 0.75, 0); // x, y (up), z, in metres

const box = object.mesh(geometry.box(1.2, 1.2, 1.2), paint);
box.position.x = 2;
box.rotation.y = Math.PI / 4; // an eighth of a turn

world.scene.add(ball, box);`,
    ],
  },
  {
    id: 'give-it-a-material',
    example: 'from-clay-to-chrome',
    code: [
      `const clay = material.meshStandard({ color: '#e8a25a', metalness: 0, roughness: 0.9 });
const chrome = material.meshStandard({ color: '#e8a25a', metalness: 1, roughness: 0.1 });
const glass = material.meshPhysical({ roughness: 0.02, transmission: 1, ior: 1.5, thickness: 1 });

world.scene.add(object.mesh(geometry.sphere(0.55, 64, 32), chrome));
chrome.roughness = 0.3; // every mesh made of chrome changes at once`,
    ],
  },
  {
    id: 'light-it',
    example: 'from-noon-to-dusk',
    code: [
      `const sun = light.directional({ intensity: 3, position: [6, 10, 5], castShadow: true });
const sky = light.ambient({ intensity: 0.25, color: '#8fb4ff' });
const bulb = light.point({ intensity: 20, distance: 8, position: [0, 3, 0] });
world.scene.add(sun, sky, bulb);

sun.color.set('#ffb070'); // an evening sun`,
    ],
  },
  {
    id: 'move-the-camera',
    example: 'orbit-around-a-clockwork',
    code: [
      `const world = createWorld('view', { controls: 'orbit' });
world.camera.position.set(2.6, 3, 4.4);
world.camera.lookAt(0.2, 2.2, 0);
world.controls.target.set(0.2, 2.2, 0); // the point the camera turns around

world.controls.kind = 'fly'; // later: fly with the keyboard instead`,
    ],
  },
  {
    id: 'animate',
    example: 'a-wave-across-a-grid',
    code: [
      `world.onFrame(({ delta }) => {
  cube.rotation.y += delta * 1.5; // one and a half radians per second
  world.invalidate(); // draw again
});`,
      `const wave = animation.clip('wave', 0.8, [
  animation.numberTrack('armR.rotation.z', [0, 0.4, 0.8], [2.3, 2.8, 2.3]),
]);
animation.createMixer(robot).play(wave);`,
    ],
  },
  {
    id: 'load-a-compiled-model',
    example: 'marble-bust-on-its-pedestal',
    code: [
      `pnpm exec trillion3d-compile models/bust.glb public/bust full 150000 /bust/`,
      `const bust = await world.scene.load('/bust/native/full/manifest.json');
world.camera.set(pose.fromBounds(bust.bounds)); // frame the whole model`,
    ],
  },
  {
    id: 'stay-within-memory',
    example: 'memory-on-a-budget',
    code: [
      `const MiB = 1024 * 1024; // one mebibyte, about a million bytes
world.budget.geometryPool = 64 * MiB; // memory for shapes
world.budget.texturePool = 256 * MiB; // memory for surface images
console.log(world.budget.geometryPool); // what the engine really holds

world.diagnostic.mode = 'clusters'; // paint each piece in its own colour`,
    ],
  },
  ...PHYSICS_CHAPTERS,
  {
    id: 'your-own-scene',
    example: 'a-scene-of-your-own',
    code: [
      `const world = createWorld('view', { controls: 'orbit' });

const wall = material.meshStandard({ color: '#efe6d2', roughness: 0.8 });
const house = object.mesh(geometry.box(1.6, 1.2, 1.4), wall);
house.position.set(-1.2, 0.6, 0.4);
const sails = object.group(); // four boxes that turn together
world.scene.add(house, sails);

const sun = light.directional({ intensity: 3, position: [6, 10, 4], castShadow: true });
world.scene.add(sun, light.ambient({ intensity: 0.25, color: '#8fb4ff' }));

world.onFrame(({ delta }) => {
  sails.rotation.z -= delta * 1.5;
  world.invalidate();
});`,
    ],
  },
];
