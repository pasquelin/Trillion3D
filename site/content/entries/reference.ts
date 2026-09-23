import generated from '../reference/api.json' with { type: 'json' };
import type { EntryFrame } from '../i18n/entries.ts';
import type { EntryNote, PortalEntry } from '../model.ts';
import { BATCHES } from './batches.ts';
import { BOUNDS } from './bounds.ts';
import { CAMERA, HOST_CAMERA } from './camera.ts';
import { ENUMS_IMAGE } from './enums.ts';
import { ENUMS_RUNTIME } from './enumsRuntime.ts';
import { LIFECYCLE } from './lifecycle.ts';
import { MATRICES } from './matrix.ts';
import { TREE } from './tree.ts';
import { COLORS, VECTORS } from './vector.ts';

/** The written notes, by the id of the entry each one completes. */
export const NOTES = new Map<string, EntryNote>(
  [
    ...ENUMS_IMAGE,
    ...ENUMS_RUNTIME,
    ...LIFECYCLE,
    ...CAMERA,
    ...HOST_CAMERA,
    ...MATRICES,
    ...VECTORS,
    ...COLORS,
    ...BOUNDS,
    ...TREE,
    ...BATCHES,
  ].map((note) => [note.id, note]),
);

/** The API reference: every public export, family member and world member the generator found
 *  (`scripts/generate-api-reference.ts`), each with what its written note adds; the note's words
 *  are the language's, given when the entries are localized. */
export const REFERENCE: EntryFrame[] = (generated as PortalEntry[]).map((entry) => ({
  ...entry,
  ...NOTES.get(entry.id),
}));
