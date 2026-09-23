import type { PortalEntry } from '../../content/model.ts';
import { COURSE } from '../../content/entries/course.ts';
import { GUIDES } from '../../content/entries/guides.ts';
import { INTERNALS } from '../../content/entries/internals.ts';

/** The written entries — the course, the guides and the internals: small, loaded with the
 *  portal. */
export const writtenEntries: PortalEntry[] = [...COURSE, ...GUIDES, ...INTERNALS];
