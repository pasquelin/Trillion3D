import type { DiagnosticMode as EngineDiagnosticMode } from '../../../packages/sdk/index.ts';

// The diagnostic modes every documentation viewport offers, in display order; labels live in
// `sceneCopy[locale]` (content.ts). Availability is the engine's word, not this list's.
export const DIAGNOSTIC_MODES = [
  'beauty',
  'clusters',
  'pages',
  'wireframe',
  'lod',
  'screen-error',
  'materials',
  'visibility',
] as const satisfies readonly EngineDiagnosticMode[];

export type DiagnosticMode = (typeof DIAGNOSTIC_MODES)[number];

const MODES: ReadonlySet<string> = new Set(DIAGNOSTIC_MODES);

/** Whether a select's value names one of the offered modes: the DOM gives a string. */
export const isDiagnosticMode = (value: string): value is DiagnosticMode => MODES.has(value);
