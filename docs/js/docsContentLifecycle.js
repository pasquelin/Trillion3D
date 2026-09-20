/** Engine lifecycle: compiling a scene, opening an explorer, driving it. */
const NODE = { section: 'lifecycle', kind: 'Function', module: 'packages/sdk-node/index.mts' };
const BROWSER = { section: 'lifecycle', kind: 'Function' };

export const LIFECYCLE = [
  {
    ...NODE,
    id: 'prepare',
    exports: ['prepare'],
    title: 'prepare()',
    signature:
      'prepare(input: string, output: string, scope = DEFAULT_SCOPE, budget = 150000, options: PrepareOptions): Promise<CompilationResult>',
    description:
      'Compiles a source scene into the cache the browser reads. Runs the native compiler — the production path — and returns the manifest read from disk, its `metrics` completed by what only the pointer holds (`wallMs`, `pruneMs`). `resourceBaseUrl` is required: it is the URL the browser will fetch pages and textures from.',
    values: [
      {
        name: 'input',
        desc: 'A directory with a `manifest.json`, a directory holding exactly one glTF/GLB, or a `.gltf`/`.glb`/`.fbx`/`.obj` file. Polygon faces of the USD, Blender, Alembic and Maya readers are triangulated at import: a strictly convex face as a fan in one pass over its corners, any other by ear clipping, which keeps the area and outline of a concave face.',
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
    id: 'createExplorer',
    exports: ['createExplorer'],
    title: 'createExplorer()',
    module: 'packages/sdk-browser/explorer.ts',
    signature:
      'createExplorer(target: ExplorerTarget, options: ExplorerOptions): Promise<Explorer>',
    valuesTitle: 'What the explorer offers',
    description:
      "Opens a compiled cache on a canvas element or literal ID (ExplorerTarget). With `interactive: true`, it submits the first image, owns controls, follows CSS size and browser DPR, and redraws on demand. This path defaults to direct WebGPU and rejects unavailable WebGPU. Without the option, the host owns rendering and the existing defaults stay unchanged. The host always owns the canvas and calls `dispose()` when done — hosted Orbit/Fly controls created through the explorer are disposed with it. The default camera is framed from the loaded bounding box. `preload: 'visible'` (the default) streams the detail of the current camera after a complete, camera-independent root cover is resident; use a manual session with `awaitPages()` for deterministic captures.",
    values: [
      {
        name: 'invalidate()',
        desc: 'After programmatic camera, scene or light edits: coalesces an interactive frame; draws immediately in manual mode.',
      },
      { name: 'render(pose?)', desc: 'Draws one frame and returns its `FrameMetrics`.' },
      {
        name: 'setPose(pose) / pointsOfInterest() / resetHome()',
        desc: 'Camera poses; the home pose comes from the loaded bounds, extra named poses from the `pointsOfInterest` option.',
      },
      {
        name: 'awaitPages() / flush()',
        desc: 'Waits for the pages the current view reads; `flush()` redraws until nothing missing remains, for a deterministic capture.',
      },
      {
        name: 'setDiagnostic(mode) / diagnostics',
        desc: 'Selects a `DiagnosticMode`, and reads which ones this backend can produce.',
      },
      { name: 'setPixelError(value)', desc: 'Changes the screen-error threshold of the cut.' },
      { name: 'capture() / resize(w, h)', desc: 'Reads the drawn surface; resizes the targets.' },
      {
        name: 'stageProfile() / getReport()',
        desc: 'Per-stage CPU/GPU quantiles, and the telemetry report.',
      },
      {
        name: 'addLight / setLight / removeLight / setEnvironment',
        desc: 'Scene lighting, declared before the first backend prepares.',
      },
      { name: 'dispose()', desc: 'Releases backends, GPU device and sources. Mandatory.' },
    ],
    example: `// HTML: <canvas id="viewer" style="width:100%;height:70vh"></canvas>
const explorer = await createExplorer('viewer', {
  manifestUrl: '/cache/city/manifest.json', scope: 'full', interactive: true,
});
// In your page/component teardown: explorer.dispose();`,
  },
  {
    ...BROWSER,
    id: 'createExplorerJob',
    exports: ['createExplorerJob'],
    title: 'createExplorerJob()',
    module: 'packages/sdk-browser/index.ts',
    signature: 'createExplorerJob(id: string, target: ExplorerTarget, options: ExplorerOptions)',
    description:
      'The same creation as a cancellable job: preparation events become job progress, and an abort before the end disposes the explorer it would have returned. A completed explorer is owned by the caller.',
    example: `const job = await createExplorerJob('city-job', 'viewer', {
  manifestUrl, scope: 'full', interactive: true,
});
job.subscribe(() => console.log(job.getSnapshot().progress));
const explorer = await job.promise;`,
  },
  {
    ...BROWSER,
    id: 'createJob',
    exports: ['createJob'],
    title: 'createJob()',
    module: 'packages/sdk-core/jobs.ts',
    signature:
      'createJob<T>(id, work: ({ signal, progress }) => Promise<T>, options?: { signal, telemetry })',
    description:
      'Wraps any pending operation in the engine job contract: a snapshot (`JobStatus`, progress, result, error), subscription, and an abort that disposes what the job owned. The operation must support abort through its owner (RAF, readback, …).',
    example: `const job = createJob('decode', async ({ signal, progress }) => {
  progress({ phase: 'pages', completed: 0, total: 12 });
  return decodePages(signal);
});`,
  },
  {
    ...BROWSER,
    id: 'detectCapabilities',
    exports: ['detectCapabilities'],
    title: 'detectCapabilities()',
    module: 'packages/sdk-browser/capabilities.ts',
    signature:
      "detectCapabilities(mode: 'webgl' | 'webgpu', canvas: HTMLCanvasElement, environment?: { gpu, createWebglCanvas })",
    description:
      'What this machine actually supports, before an explorer is opened: `{ tier, renderer, adapter, extensions, reason }`. The reason is always given, so an unsupported capability is reported rather than assumed. The WebGL2 probe is cached.',
    example: `const capabilities = await detectCapabilities('webgpu', canvas);
console.log(capabilities.tier, capabilities.renderer, capabilities.reason);`,
  },
  {
    ...BROWSER,
    id: 'runCameraPath',
    exports: ['runCameraPath'],
    title: 'runCameraPath()',
    module: 'packages/sdk-browser/cameraPath.ts',
    signature:
      'runCameraPath(explorer, path: readonly CameraPose[], options: { backendIds, warmup, … })',
    description:
      'A campaign helper: an exact A/A image gate, then timed blocks over the same pose list. It is not a general performance verdict — a host that switches backends replays the same poses per backend and never mixes engines inside one timed block. A `CameraPose` is `{ position, target, fov, near, far }`.',
    example: `const runs = await runCameraPath(explorer, poses, { backendIds: ['webgpu-page-raster'], warmup: 8 });`,
  },
  {
    ...BROWSER,
    id: 'replicateInstances',
    exports: ['replicateInstances'],
    title: 'replicateInstances()',
    module: 'packages/sdk-browser/replicateInstances.ts',
    signature: 'replicateInstances(...)',
    description:
      'Instances the source 1, 4 or 9 times while sharing geometry and materials — the `replicaCount` option goes through it. A measurement helper for scenes larger than the asset on disk.',
  },
  {
    ...BROWSER,
    id: 'createGpuPageCache',
    exports: ['createGpuPageCache', 'httpPageSource'],
    title: 'createGpuPageCache() · httpPageSource()',
    module: 'packages/sdk-browser/gpuPages.ts',
    signature: 'createGpuPageCache(...) · httpPageSource(...)',
    description:
      'The bounded WebGPU buffer/queue adapter that holds resident pages, and the HTTP source that feeds it. `webgpuPagesBackend` (`webgpu-page-raster`) consumes the same pages and LOD settings; residency is driven by what the frame actually reads, within the declared budget.',
  },
];
