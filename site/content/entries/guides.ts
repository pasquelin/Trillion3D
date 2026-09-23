import type { PortalEntry } from '../model.ts';

/** Guides: prose in `html`, rendered by the React Entry component. */
const GUIDE = { section: 'guides', kind: 'Guide' };

export const GUIDES: PortalEntry[] = [
  {
    ...GUIDE,
    id: 'three-migration',
    title: 'Migration from Three.js',
    description:
      'On the left a complete Three.js program, on the right the engine program that draws the same scene, section by section.',
  },
  {
    ...GUIDE,
    section: 'guides',
    id: 'measurement-entry',
    title: 'The measurement entry point',
    description:
      'Where a witness, a forced backend or an internal session is still nameable — never through the published `web-geometry` entry.',
    html: `<p>A page imports <code>web-geometry</code> and never sees a backend, a witness or an internal session: <code>createWorld</code> draws with one renderer, chosen from the machine or refused by name if forced and missing. The bench, the proofs and the comparison views still need to name a witness — bare Three.js, <code>THREE.LOD</code>, the internal <code>openMeasuredWorld</code> session — and that is the one job of the separate measurement entry point, <code>packages/sdk-browser/src/measurement/measurement.ts</code>.</p>
<p>It re-exports everything the published entry does, plus what a host never needs: <code>openMeasuredWorld</code>/<code>createMeasuredWorldJob</code> (the internal session a world opens on itself), the backend factories (<code>referenceBackend</code>, <code>exactPagesBackend</code>, <code>threeLodBackend</code>, <code>webgpuPagesBackend</code>, <code>autonomousPagesBackend</code>), and measurement-only helpers such as <code>replicateInstances</code>. None of it reaches a published world, and none of it is imported by an application.</p>`,
  },
  {
    ...GUIDE,
    id: 'createWorldJob',
    title: 'A world load as a cancellable job',
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
];
