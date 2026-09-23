import type { PortalEntry } from '../../content/model.ts';
import { COURSE } from '../../content/entries/course.ts';
import { GUIDES } from '../../content/entries/guides.ts';
import { INTERNALS } from '../../content/entries/internals.ts';
import { REFERENCE } from '../../content/entries/reference.ts';

export const rawEntries: PortalEntry[] = [...COURSE, ...GUIDES, ...INTERNALS, ...REFERENCE];
