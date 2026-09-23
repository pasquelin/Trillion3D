import type { PortalEntry } from '../model.ts';
import { NODE, BROWSER, LIFECYCLE_WORLD } from '../lifecycleWorld.ts';

/** Engine lifecycle: compiling a scene, creating a world. Driving it after creation continues
 *  in `../lifecycleWorld.ts`, concatenated below in the same order the French overlay expects. */
const CORE: PortalEntry[] = [
  {
    ...NODE,
    id: 'prepare',
    exports: ['prepare'],
    title: 'prepare()',
    signature:
      'prepare(input: string, output: string, scope = DEFAULT_SCOPE, budget = 150000, options: PrepareOptions): Promise<CompilationResult>',
    description:
      'Compiles a source scene into the cache the browser reads. Runs the native compiler — the production path — and returns the manifest read from disk, its `metrics` completed by what only the pointer holds (`wallMs`, `pruneMs`). A source whose product is already in the cache is not recompiled: the folder is proven file by file and kept, and `reused` says what was checked (`null` when the job compiled). `resourceBaseUrl` is required: it is the URL the browser will fetch pages and textures from. What each reader does to its source — polygon faces cut as a fan when convex, by ear clipping otherwise — is in `docs/COMPILER.md`.',
    values: [
      {
        name: 'input',
        desc: 'A directory with a `manifest.json`, a directory holding exactly one glTF/GLB, or a `.gltf`/`.glb`/`.fbx`/`.obj` file.',
      },
      { name: 'output', desc: 'The cache directory. The source is never overwritten.' },
      { name: 'scope', desc: "`'slice'` or `'full'`." },
      { name: 'budget', desc: 'Triangle budget, `150000` by default.' },
      {
        name: 'options',
        desc: "`{ resourceBaseUrl, executable, threads = 2, ramBudgetMb = 256, simplification = 'none', signal, onProgress }`. `WEB_GEOMETRY_COMPILER_BIN` names the executable when `executable` does not.",
      },
    ],
    example: `import { prepare } from 'web-geometry';

const result = await prepare('scenes/city', 'cache/city', 'full', 150000, {
  resourceBaseUrl: '/cache/city/',
  threads: 4,
  onProgress: (event) => console.log(event.phase, event.completed, event.total),
});
console.log(result.metrics.wallMs);`,
  },
  {
    ...NODE,
    id: 'prepareMany',
    exports: ['prepareMany'],
    title: 'prepareMany()',
    signature: 'prepareMany(jobs: BatchJob[], options: BatchOptions = {}): Promise<BatchSummary>',
    description:
      'Prepares many models in one compiler process. The compiler runs `workers` jobs at a time and splits `ramBudgetMb` between them. Resolves with the batch summary — pointers only, nothing read back from disk.',
    values: [
      {
        name: 'jobs',
        desc: '`{ id, source, cache, scope, triangles, resourceBaseUrl, simplification, threads, ramBudgetMb }`; a non-empty array, `resourceBaseUrl` required on each.',
      },
      {
        name: 'options',
        desc: '`{ workers, ramBudgetMb, threads, onEvent }`. `createBatchProgress` prints one line per job id, in arrival order.',
      },
    ],
    example: `import { createBatchProgress, prepareMany } from 'web-geometry';

const summary = await prepareMany(jobs, { workers: 2, onEvent: createBatchProgress() });`,
  },
  {
    ...BROWSER,
    section: 'world',
    id: 'createWorld',
    exports: ['createWorld'],
    title: 'createWorld()',
    module: 'packages/sdk-browser/src/world/core/world.ts',
    signature:
      'createWorld(target: HTMLCanvasElement | HTMLElement | string, options?: WorldOptions): World',
    valuesTitle: 'What the world offers',
    description:
      "Creates an empty world on a canvas element or its id. The world owns the scene, the camera, the renderer and the loop; nothing else is constructed — a compiled model is loaded afterwards with `scene.load`, like any other thing added to the scene. `interactive` defaults to true: the world submits frames on demand and pauses once the image has held for 120 frames, resuming on `invalidate()`. `renderer` is absent by default (the engine takes the best path the machine grants) or names one explicitly (`'webgpu'` / `'webgl2'`); forcing one on a machine that lacks it is refused by name, never silently served the other. `controls` picks the camera controller (`'orbit'` | `'fly'` | `'firstPerson'` | `'trackball'` | `'panZoom'` | `'none'`, the default), read or changed later through `world.controls.kind`.",
    values: [
      {
        name: 'scene.add(...) / scene.remove(...) / scene.load(url, options?)',
        desc: 'Builds the scene from `geometry`/`material`/`object`/`light`, or loads a compiled cache; `load` resolves with the `LoadedModel` (`bounds`, `lights`).',
      },
      {
        name: 'camera',
        desc: 'A live `Camera`: `position.set(...)`, `lookAt(...)`, `fov`/`near`/`far`, or `camera.set(pose)` with a `CameraPose` such as `pose.fromBounds(box3)` returns.',
      },
      {
        name: 'controls.kind / .enabled / .target',
        desc: 'The live controller that drives the camera from the canvas: `.kind`, `.enabled`, `.target` — set at creation, changeable at any time.',
      },
      {
        name: 'onFrame(cb) / loop(cb) / invalidate()',
        desc: 'The per-frame hook (`loop` is its alias) and the request to draw again after a manual change; returns an unsubscribe function.',
      },
      {
        name: 'render() / resize(width?, height?)',
        desc: 'Draws one frame by hand (host-led loop, `interactive: false`); resizes the targets.',
      },
      {
        name: 'exposure',
        desc: 'The multiplier applied to linear radiance before ACES; it cannot light a surface no declared light reaches.',
      },
      {
        name: 'pixelError',
        desc: 'The DAG cut’s screen error, in pixels — `0` keeps the exact leaves.',
      },
      {
        name: 'budget.geometryPool / .texturePool',
        desc: 'Read/write properties for the fixed geometry and texture pools; read-only `geometryPoolCeiling`, `texturePoolCeiling` cap them.',
      },
      {
        name: 'diagnostic.mode / diagnostic.modes',
        desc: "Selects what the frame draws (`'beauty' | 'clusters' | 'wireframe' | 'triangles'`), and reads which modes this device can produce.",
      },
      {
        name: 'toneMapping',
        desc: 'The tone-mapping curve applied at composition, e.g. `toneMapping.aces` (the default).',
      },
      {
        name: 'dispose()',
        desc: 'Releases the renderer, the GPU device and every resident page. Mandatory.',
      },
    ],
    example: `// HTML: <canvas id="viewer" style="width:100%;height:70vh"></canvas>
const world = createWorld('viewer', { controls: 'orbit' });
world.toneMapping = toneMapping.aces;
await world.scene.load('/cache/city/manifest.json');
// In your page/component teardown: world.dispose();`,
  },
];

export const LIFECYCLE: PortalEntry[] = [...CORE, ...LIFECYCLE_WORLD];
