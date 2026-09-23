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

/** The written French overlays, by entry id, merged over `base`: a written overlay completes the
 *  generated one of the same id rather than replacing it. */
export const withWrittenFrench = (base: LocaleOverlay): LocaleOverlay =>
  WRITTEN.reduce<LocaleOverlay>(
    (merged, overlays) => {
      for (const [id, overlay] of Object.entries(overlays))
        merged[id] = { ...merged[id], ...overlay };
      return merged;
    },
    { ...base },
  );

const WRITTEN: LocaleOverlay[] = [
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
];

/** The written French overlays alone: what the guides need, without the generated reference. */
export const WRITTEN_FRENCH = withWrittenFrench({});
