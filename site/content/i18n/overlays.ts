import { boundsFr } from './bounds.fr.ts';
import { cameraFr } from './camera.fr.ts';
import { courseFr } from './course.fr.ts';
import { enumsFr } from './enums.fr.ts';
import { guidesFr } from './guides.fr.ts';
import { lifecycleFr } from './lifecycle.fr.ts';
import { internalsFr } from './internals.fr.ts';
import { matrixFr } from './matrix.fr.ts';
import { treeFr } from './tree.fr.ts';
import { vectorFr } from './vector.fr.ts';
import { worldGuidesFr } from './worldGuides.fr.ts';

import type { LocaleOverlay } from './entryOverlay.ts';

/** Every French entry overlay, by entry id: what `localizeEntries` applies over the English source. */
export const FRENCH: LocaleOverlay = Object.assign(
  {},
  boundsFr,
  cameraFr,
  courseFr,
  enumsFr,
  guidesFr,
  lifecycleFr,
  internalsFr,
  matrixFr,
  treeFr,
  vectorFr,
  worldGuidesFr,
);
