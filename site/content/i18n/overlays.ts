import { boundsFr } from './bounds.fr.ts';
import { cameraFr } from './camera.fr.ts';
import { enumsFr } from './enums.fr.ts';
import { guidesFr } from './guides.fr.ts';
import { lifecycleFr } from './lifecycle.fr.ts';
import { lightingFr } from './lighting.fr.ts';
import { matrixFr } from './matrix.fr.ts';
import { referenceFr } from './reference.fr.ts';
import { treeFr } from './tree.fr.ts';
import { vectorFr } from './vector.fr.ts';
import { worldGuidesFr } from './worldGuides.fr.ts';

import type { LocaleOverlay } from './entryOverlay.ts';

/** Every French entry overlay, by entry id: what `localizeEntries` applies over the English source.
 *  A written overlay completes the generated one of the same id rather than replacing it. */
export const FRENCH: LocaleOverlay = [
  boundsFr,
  cameraFr,
  enumsFr,
  guidesFr,
  lifecycleFr,
  lightingFr,
  matrixFr,
  treeFr,
  vectorFr,
  worldGuidesFr,
].reduce<LocaleOverlay>(
  (merged, overlays) => {
    for (const [id, overlay] of Object.entries(overlays)) merged[id] = { ...merged[id], ...overlay };
    return merged;
  },
  { ...referenceFr },
);
