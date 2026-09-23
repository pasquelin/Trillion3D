import type { PortalEntry } from './model.ts';

/** Shared row markers for the lifecycle entries, split between `entries/lifecycle.ts` and this
 *  file to keep each under the line budget. It lives outside `entries/` because the portal reads
 *  every export of that folder as a list of entries; the rows below reach the portal once,
 *  concatenated by `LIFECYCLE` in the order the French overlay (`lifecycle.fr.ts`) merges onto. */
export const NODE = {
  section: 'lifecycle',
  kind: 'Function',
  module: 'packages/sdk-node/src/index.mts',
};
export const BROWSER = { section: 'lifecycle', kind: 'Function' };

/** The rest of the lifecycle entries, after `createWorld` (`lifecycle.ts`): a world's own job
 *  wrapper, capability detection, camera paths, measurement and paged geometry. */
export const LIFECYCLE_WORLD: PortalEntry[] = [
  {
    ...BROWSER,
    section: 'world',
    id: 'createWorldJob',
    exports: ['createJob'],
    title: 'A world load as a cancellable job',
    module: 'packages/sdk-core/src/runtime/jobs.ts',
    signature: 'createJob<World>(id, ({ signal, progress }) => Promise<World>, options?)',
    description:
      'A world has no dedicated job wrapper of its own: `scene.load` is a plain promise, and the generic `createJob` helper turns it into a cancellable one with progress when a host needs the same job contract compilation uses.',
    example: `const job = createJob('city-world', async ({ signal }) => {
  const world = createWorld('viewer', { signal });
  await world.scene.load('/cache/city/manifest.json', { signal });
  return world;
});
job.subscribe(() => console.log(job.getSnapshot().progress));
const world = await job.promise;`,
  },
  {
    ...BROWSER,
    id: 'createJob',
    exports: ['createJob'],
    title: 'createJob()',
    module: 'packages/sdk-core/src/runtime/jobs.ts',
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
    module: 'packages/sdk-browser/src/measurement/capabilities.ts',
    signature:
      "detectCapabilities(mode: 'webgl' | 'webgpu', canvas: HTMLCanvasElement, environment?: { gpu, createWebglCanvas })",
    description:
      'What this machine actually supports, before a world is created: `{ tier, renderer, adapter, extensions, reason }`. The reason is always given, so an unsupported capability is reported rather than assumed. The public wrapper a world reads is `capability.detect()` — `{ webgpu, webgl2, ... }`, a simpler shape for the same probe. The WebGL2 probe is cached.',
    example: `const capabilities = await detectCapabilities('webgpu', canvas);
console.log(capabilities.tier, capabilities.renderer, capabilities.reason);`,
  },
  {
    ...BROWSER,
    section: 'families',
    id: 'runCameraPath',
    exports: ['pose'],
    title: 'pose.runPath()',
    module: 'packages/sdk-browser/src/world/pose/index.ts',
    signature:
      'pose.runPath(world: World, poses: CameraPose[], options?: { images? }): Promise<void>',
    description:
      'Replays a list of poses through a world, spread evenly over `images` frames (or one per pose), eye and target moving in a straight line between two. A `CameraPose` is `{ position, target, fov? }` — near/far stay on the camera itself. Internally a campaign helper, `runCameraPath(session, path, { backendIds, warmup, … })`, drives the same replay for the bench: an exact A/A image gate, then timed blocks; not a general performance verdict, and never mixing renderers inside one timed block.',
    example: `await pose.runPath(world, [poseA, poseB, poseC], { images: 120 });`,
  },
  {
    ...BROWSER,
    section: 'measurement',
    id: 'replicateInstances',
    exports: ['replicateInstances'],
    title: 'replicateInstances()',
    module: 'packages/sdk-browser/src/scene/replicateInstances.ts',
    signature: 'replicateInstances(...)',
    description:
      'Instances the source 1, 4 or 9 times while sharing geometry and materials — the `replicaCount` option goes through it. A measurement helper reached only through the measurement entry point (`packages/sdk-browser/src/measurement/measurement.ts`), for scenes larger than the asset on disk; not part of `web-geometry`’s published entry.',
  },
  {
    ...BROWSER,
    section: 'families',
    id: 'createGpuPageCache',
    exports: ['page'],
    title: 'page.createCache() · page.httpSource()',
    module: 'packages/sdk-browser/src/world/page/index.ts',
    signature:
      'page.createCache(device: GPUDevice, source: PageSource, options: { pageBytes: number, slots: number }) · page.httpSource(baseUrl: string)',
    description:
      'The `page` family: geometry cut into pages, moved in and out of memory by what the frame reads. `page.createCache` is the bounded WebGPU buffer/queue adapter (`createGpuPageCache`) that holds resident pages; `page.httpSource` the HTTP source that feeds it (`httpPageSource`). The internal renderer that consumes the same pages and LOD settings is chosen by `createWorld`’s `renderer` option, never named by a host.',
  },
];
