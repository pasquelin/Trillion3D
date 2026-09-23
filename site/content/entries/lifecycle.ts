import type { EntryNote } from '../model.ts';

/** What the reference adds by hand to the compiler and job entries: a longer text and an example. */
export const LIFECYCLE: EntryNote[] = [
  {
    id: 'prepare',
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
    example: `import { createBatchProgress, prepareMany } from 'web-geometry';

const summary = await prepareMany(jobs, { workers: 2, onEvent: createBatchProgress() });`,
  },
  {
    id: 'createJob',
    example: `const job = createJob('decode', async ({ signal, progress }) => {
  progress({ phase: 'pages', completed: 0, total: 12 });
  return decodePages(signal);
});`,
  },
  {
    id: 'detectCapabilities',
    example: `const capabilities = await detectCapabilities('webgpu', canvas);
console.log(capabilities.tier, capabilities.renderer, capabilities.reason);`,
  },
];
