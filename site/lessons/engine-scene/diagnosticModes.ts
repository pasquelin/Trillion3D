// The diagnostic modes every documentation viewport offers, in display order; labels live in
// `sceneCopy[locale]` (content.ts). Availability is `world.diagnostic.modes`, read at mount time,
// never this list alone: a mode named here that the device does not offer stays disabled.
export const DIAGNOSTIC_MODES = ['beauty', 'clusters', 'wireframe', 'triangles'] as const;

export type DiagnosticMode = (typeof DIAGNOSTIC_MODES)[number];

const MODES: ReadonlySet<string> = new Set(DIAGNOSTIC_MODES);

/** Whether a select's value names one of the offered modes: the DOM gives a string. */
export const isDiagnosticMode = (value: string): value is DiagnosticMode => MODES.has(value);
