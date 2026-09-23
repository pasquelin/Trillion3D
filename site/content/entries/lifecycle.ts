import type { EntryNote } from '../model.ts';

/** What the reference adds by hand to the compiler and job entries: a longer text and an example. */
export const LIFECYCLE: EntryNote[] = [
  {
    id: 'prepare',
    description:
      'Compiles a source scene into the cache the browser reads. Runs the native compiler — the production path — and returns the manifest read from disk, its `metrics` completed by what only the pointer holds (`wallMs`, `pruneMs`). A source whose product is already in the cache is not recompiled: the folder is proven file by file and kept, and `reused` says what was checked (`null` when the job compiled). `resourceBaseUrl` is required: it is the URL the browser will fetch pages and textures from. What each reader does to its source — polygon faces cut as a fan when convex, by ear clipping otherwise — is in `docs/COMPILER.md`.',
    example: `import { prepare } from 'web-geometry';

const result = await prepare('scenes/city', 'cache/city', 'full', 150000, {
  resourceBaseUrl: '/cache/city/',
  threads: 4,
  onProgress: (event) => console.log(event.phase, event.completed, event.total),
});
console.log(result.metrics.wallMs);`,
  },
  {
    id: 'prepareMany',
    description:
      'Prepares many models in one compiler process. The compiler runs `workers` jobs at a time and splits `ramBudgetMb` between them. Resolves with the batch summary — pointers only, nothing read back from disk.',
    example: `import { createBatchProgress, prepareMany } from 'web-geometry';

const summary = await prepareMany(jobs, { workers: 2, onEvent: createBatchProgress() });`,
  },
  {
    id: 'createJob',
    description:
      'Wraps any pending operation in the engine job contract: a snapshot (`JobStatus`, progress, result, error), subscription, and an abort that disposes what the job owned. The operation must support abort through its owner (RAF, readback, …).',
    example: `const job = createJob('decode', async ({ signal, progress }) => {
  progress({ phase: 'pages', completed: 0, total: 12 });
  return decodePages(signal);
});`,
  },
  {
    id: 'detectCapabilities',
    description:
      'What this machine actually supports, before a world is created: `{ tier, renderer, adapter, extensions, reason }`. The reason is always given, so an unsupported capability is reported rather than assumed. The public wrapper a world reads is `capability.detect()` — `{ webgpu, webgl2, ... }`, a simpler shape for the same probe. The WebGL2 probe is cached.',
    example: `const capabilities = await detectCapabilities('webgpu', canvas);
console.log(capabilities.tier, capabilities.renderer, capabilities.reason);`,
  },
];
