import type { CatalogExample } from '../../content/catalog.ts';
import type roadmapModule from '../../content/gallery-roadmap.json';

/** One roadmap entry, as `gallery-roadmap.json` declares it, with the fields a ready example
 * carries but a roadmap entry does not yet (populated once a ready lesson covers it). */
export type RoadmapExample = (typeof roadmapModule)['entries'][number] & {
  description?: undefined;
  functions?: string[];
  engine?: boolean;
  renderer?: boolean;
  preview?: string;
  readyLessonId?: string;
};

export type GalleryExample = CatalogExample | RoadmapExample;

const plans: Record<string, string[]> = {
  animation: [
    'Define original bones, weights, and deterministic motion samples.',
    'Add a public skeletal animation contract before importing it here.',
    'Visualize bind pose, animated pose, and the measured deformation.',
  ],
  loader: [
    'Define a tiny original fixture for the source format.',
    'Add or verify the compiler importer and its explicit failure semantics.',
    'Display source primitives beside the validated compiled result.',
  ],
  postprocessing: [
    'Define the input and output texture contract for the effect.',
    'Add a composable public render-pass hook with bounded allocations.',
    'Compare the unprocessed and processed images with measured pass cost.',
  ],
  texture: [
    'Create an original procedural texture fixture.',
    'Verify decode, upload, sampling, and material-binding contracts.',
    'Show source texels, selected mip, and the rendered surface.',
  ],
  physics: [
    'Define original bodies, colliders, and a deterministic timestep.',
    'Add a public collision and solver contract before integration.',
    'Visualize contacts, motion, and bounded simulation work.',
  ],
};

export function planCode(entry: Pick<RoadmapExample, 'category' | 'subject' | 'title'>): string {
  const key = entry.category.includes('postprocessing')
    ? 'postprocessing'
    : entry.category === 'physics'
      ? 'physics'
      : entry.subject.includes('texture')
        ? 'texture'
        : entry.subject;
  const steps = plans[key] ?? [
    `Audit the public Web Geometry contracts required for ${entry.subject}.`,
    'Design original procedural inputs and deterministic controls.',
    'Implement, test, and measure the result before marking this lesson ready.',
  ];
  return [
    `// Planned original lesson: ${entry.title.en}`,
    ...steps.map((step, i) => `// ${i + 1}. ${step}`),
    '// TODO: this plan is intentionally non-runnable until the missing contract is implemented.',
  ].join('\n');
}
