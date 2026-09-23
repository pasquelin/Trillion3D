import type { PortalEntry } from '../../content/model.ts';
import { EXAMPLES } from '../../content/entries/examples.ts';
import { FORMAT_GUIDES } from '../../content/entries/format.ts';
import { GUIDES } from '../../content/entries/guides.ts';
import { RENDERING_GUIDES } from '../../content/entries/guidesRendering.ts';
import { ENGINE_GUIDES } from '../../content/entries/guidesEngine.ts';
import { LIGHTING_GUIDES } from '../../content/entries/lighting.ts';
import { REFERENCE } from '../../content/entries/reference.ts';

export const rawEntries: PortalEntry[] = [
  ...GUIDES,
  ...FORMAT_GUIDES,
  ...RENDERING_GUIDES,
  ...ENGINE_GUIDES,
  ...LIGHTING_GUIDES,
  ...EXAMPLES,
  ...REFERENCE,
];
