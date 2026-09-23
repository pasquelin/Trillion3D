import type { EntryFrame } from '../i18n/entries.ts';

/** "How it works": what the engine does inside, one screen each, for a curious reader. */
const INTERNAL = { section: 'internals', kind: 'Guide' };

export const INTERNALS: EntryFrame[] = [
  {
    ...INTERNAL,
    id: 'architecture',
  },
  {
    ...INTERNAL,
    id: 'occlusion-two-phase',
  },
  {
    ...INTERNAL,
    id: 'cluster-format',
  },
  {
    ...INTERNAL,
    id: 'water-pass',
  },
  {
    ...INTERNAL,
    id: 'memory-pools',
  },
  {
    ...INTERNAL,
    id: 'texture-compression',
  },
  {
    ...INTERNAL,
    id: 'shadow-pages',
  },
];
