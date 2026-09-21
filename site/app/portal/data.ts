import type { PortalEntry } from '../../content/model.ts';
import { EXAMPLES } from '../../content/entries/examples.ts';
import { GUIDES } from '../../content/entries/guides.ts';
import { RENDERING_GUIDES } from '../../content/entries/guidesRendering.ts';
import { ENGINE_GUIDES } from '../../content/entries/guidesEngine.ts';
import { ENUMS_IMAGE } from '../../content/entries/enums.ts';
import { ENUMS_RUNTIME } from '../../content/entries/enumsRuntime.ts';
import { LIFECYCLE } from '../../content/entries/lifecycle.ts';
import { CAMERA, HOST_CAMERA } from '../../content/entries/camera.ts';
import { MATRICES } from '../../content/entries/matrix.ts';
import { COLORS, VECTORS } from '../../content/entries/vector.ts';
import { BOUNDS } from '../../content/entries/bounds.ts';
import { TREE } from '../../content/entries/tree.ts';
import { BATCHES } from '../../content/entries/batches.ts';

export const rawEntries: PortalEntry[] = [
  ...GUIDES,
  ...RENDERING_GUIDES,
  ...ENGINE_GUIDES,
  ...EXAMPLES,
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
];
