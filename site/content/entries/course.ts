import { courseEntries } from './courseHtml.ts';
import type { ChapterText, CourseWords } from './courseHtml.ts';

/** The course's shared headings, in English. */
const WORDS: CourseWords = {
  picture: 'What you will build',
  steps: 'Step by step',
  code: 'The code',
  tryIt: 'Try it',
  open: 'Open it full size, read its whole code and change it',
  next: 'Next chapter',
  end: 'Now browse the examples',
};

/** The words of each chapter, in English. Short sentences; a word is explained the first time. */
export const COURSE_TEXT: Record<string, ChapterText> = {
  'create-a-world': {
    title: 'Create a world',
    description:
      'A world is the place where your 3D scene lives. One call creates it, and it draws into a canvas on your page.',
    steps: [
      'Get the engine. It is not on npm yet: clone the repository, run <code>pnpm install</code> and <code>pnpm run build</code> in it, then add it to your project from that folder.',
      'Put a <code>&lt;canvas&gt;</code> in your page. A canvas is a rectangle of the page that a program can draw into. Give it a width and a height.',
      'Call <code>createWorld</code> with the canvas id. You get a world: a <em>scene</em> (the list of things to draw), a <em>camera</em> (the eye that looks at them) and everything that draws the picture.',
      'Add one cube and one light, so there is something to see. The next chapters explain these lines one by one.',
      'When your page closes, call <code>world.dispose()</code> to give the memory back.',
    ],
    tryIt: 'Drag the picture to turn around the cube. Pick another colour in the panel.',
  },
  'add-a-shape': {
    title: 'Add a shape',
    description:
      'Everything you see is a mesh: a shape with a material on it. Make the shape with `geometry`, wrap it in a mesh with `object.mesh`, and add it to the scene.',
    steps: [
      'A shape, or <em>geometry</em>, is only the form: its corners and its faces. <code>geometry.box(1, 1, 1)</code> is a cube one metre wide, <code>geometry.sphere(0.75)</code> a ball. There are also cylinders, cones, rings, tori and more.',
      'A <em>mesh</em> is a shape plus a material: <code>object.mesh(shape, material)</code>. The material is the next chapter.',
      'Place a mesh with <code>position</code>, turn it with <code>rotation</code> and size it with <code>scale</code>. Rotations are in radians: a full turn is <code>Math.PI * 2</code>.',
      '<code>object.group()</code> holds several meshes, so they move together, like the plate of the turntable.',
      'Nothing shows until you call <code>world.scene.add(mesh)</code>.',
    ],
    tryIt: 'Change the colour of the shapes, stop the spin, or turn it faster.',
  },
  'give-it-a-material': {
    title: 'Give it a material',
    description:
      'A material says what a surface is made of: its colour, whether it is metal, how rough it is. `material.meshStandard` covers almost everything.',
    steps: [
      '<code>color</code> is the paint, written like a web colour: <code>\'#e8a25a\'</code>.',
      '<code>metalness</code> goes from 0 (plastic, clay, wood) to 1 (metal). A metal shows the colours of what it reflects.',
      '<code>roughness</code> goes from 0 (smooth like a mirror, with small sharp highlights) to 1 (rough like chalk, with soft light everywhere).',
      'Change a material whenever you like: <code>chrome.roughness = 0.3</code>. Every mesh that uses it changes at once.',
      'Glass is <code>material.meshPhysical</code> with <code>transmission: 1</code>: light goes through it. <code>ior</code>, the index of refraction, says how much it bends light: 1.5 for window glass. See it in <a href="#/en/examples/glass-on-the-table">Glass on the table</a>.',
    ],
    tryIt: 'Each column is more metal than the one before, and each row is rougher. Pick one colour for all of them, and make the lamps brighter.',
  },
  'light-it': {
    title: 'Light it',
    description:
      'Without a light, everything is black. Add lights with the `light` family, and let them cast shadows.',
    steps: [
      '<code>light.directional</code> is the sun: all its rays go the same way, and <code>position</code> says where it shines from.',
      '<code>light.point</code> is a bulb: it shines all around and fades with <code>distance</code>. <code>light.spot</code> is a torch: a cone of light.',
      '<code>light.ambient</code> is a soft light from everywhere. A little of it keeps the shadows from being pitch black.',
      'Add <code>castShadow: true</code> and what the light hits throws a shadow.',
      '<code>intensity</code> is how strong a light is, <code>color</code> its colour. Change them any time: <code>sun.intensity = 1</code>.',
    ],
    tryIt: 'Move the hour: the sun crosses the sky, turns red at dusk, and every shadow turns with it.',
  },
  'move-the-camera': {
    title: 'Move the camera',
    description:
      'The camera is your eye in the world. Place it in code, then let the reader move it with `world.controls`.',
    steps: [
      '<code>world.camera.position.set(x, y, z)</code> puts the eye somewhere; <code>world.camera.lookAt(x, y, z)</code> turns it towards a point.',
      'A <em>controller</em> turns the mouse, fingers and keyboard into camera moves. Choose it when you create the world: <code>createWorld(\'view\', { controls: \'orbit\' })</code>.',
      '<code>\'orbit\'</code> circles a point: drag to turn, right-drag to slide, scroll to zoom. <code>world.controls.target</code> is the point it circles.',
      'There are others: <code>\'fly\'</code> (keys W A S D, see <a href="#/en/examples/fly-over-a-model-town">Fly over a model town</a>), <code>\'firstPerson\'</code> (walk, see <a href="#/en/examples/walk-through-a-temple">Walk through a temple</a>), <code>\'trackball\'</code>, <code>\'panZoom\'</code> for a flat map, and <code>\'none\'</code> when your code moves the camera itself.',
      'Switch at any time: <code>world.controls.kind = \'fly\'</code>.',
    ],
    tryIt: 'Drag to turn around the clock, scroll to look closely at the teeth of the gears.',
  },
  animate: {
    title: 'Animate',
    description:
      'To make things move, give the world a function to run before every picture, with `world.onFrame`.',
    steps: [
      'The world draws a new picture many times a second. Each picture is a <em>frame</em>. <code>world.onFrame(fn)</code> runs <code>fn</code> before each one.',
      '<code>fn</code> receives <code>delta</code>: the seconds since the last frame. Multiply your speeds by it, and things move just as fast on a quick screen as on a slow one.',
      'Call <code>world.invalidate()</code> to say “draw again”. When nothing asks for a new frame, the world rests: a scene that does not move costs nothing.',
      'For a motion made of poses, like a walk, use the animation mixer. <code>animation.clip</code> lists the poses and when they happen; <code>animation.createMixer(robot).play(clip)</code> plays them and fills in the moments between. See <a href="#/en/examples/a-robot-that-walks-and-waves">Blending robot motions</a>.',
    ],
    tryIt: 'Change the height and the speed of the wave. Double-click the floor to drop a new stone.',
  },
  'load-a-compiled-model': {
    title: 'Load a compiled model',
    description:
      'A model made in a 3D program is compiled once, then one line adds it to your world. The engine then loads only the parts the camera needs.',
    steps: [
      'Most 3D programs export <em>glTF</em> files (<code>.gltf</code> or <code>.glb</code>), the common format for 3D models.',
      'The compiler cuts the model into small pieces called <em>clusters</em>, patches of about a hundred triangles, and saves each one at several levels of detail. Run it once, in a terminal: the model, the output folder, <code>full</code> to keep the whole model, a triangle budget, and the web address the folder will be served from.',
      'Put the output folder on your web server, at that address.',
      'In the page, <code>await world.scene.load(url)</code> adds the model. It gives back the model, with its size in <code>bounds</code>, to frame the camera.',
      'The model is never downloaded whole. The engine fetches the pieces the camera sees, finer as you come closer. This is called <em>streaming</em>.',
    ],
    tryIt: 'Turn the lamp around the head, raise it, change its colour.',
  },
  'stay-within-memory': {
    title: 'Stay within memory',
    description:
      'A big model does not have to fit in memory. You give the engine a fixed amount, and it keeps what the view needs most inside it.',
    steps: [
      'The <em>GPU</em>, the chip that draws the picture, has its own memory, and a web page cannot ask how much of it is free. So you choose the amount yourself.',
      '<code>world.budget.geometryPool</code> is the memory for shapes; <code>world.budget.texturePool</code> is the memory for the images painted on surfaces, called <em>textures</em>. Both are counted in bytes.',
      'When the view needs more than the budget, nothing breaks: far and small parts are drawn with fewer triangles until everything fits. The picture stays whole, only less detailed.',
      'Read the value back to see what the engine really holds.',
      'See the pieces with <code>world.diagnostic.mode = \'clusters\'</code>: each cluster gets its own colour.',
    ],
    tryIt: 'Slide the memory down: the pieces grow bigger, the building stays whole. Switch the view to <code>clusters</code> to see them.',
  },
  'your-own-scene': {
    title: 'Your own scene',
    description:
      'You now know every piece. This chapter puts them together in one small scene that you can copy and make your own.',
    steps: [
      'Start like chapter 1: a canvas, and <code>createWorld</code> with the <code>orbit</code> controller.',
      'Build with shapes and materials, as in chapters 2 and 3: an island, a house, a tree and a windmill.',
      'Light it with a sun that casts shadows (chapter 4), and move the sun with the hour.',
      'Turn the sails in <code>world.onFrame</code> (chapter 6). They are four boxes in one group, so turning the group turns them all.',
      'Open the full code, change a number, press Run: the scene is yours. Then load a model of your own (chapter 7).',
    ],
    tryIt: 'Change the hour, the wind and the colour of the roof.',
  },
};

/** The course's nine chapters, in English. */
export const COURSE = courseEntries(COURSE_TEXT, WORDS, 'en');
