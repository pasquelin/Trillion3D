import { EXAMPLES } from '../docsContentExamples.js';
import { FORMAT_GUIDES } from '../docsContentFormat.js';
import { GUIDES } from '../docsContentGuides.js';
import { RENDERING_GUIDES } from '../docsContentGuidesRendering.js';
import { ENGINE_GUIDES } from '../docsContentGuidesEngine.js';
import { LIGHTING_GUIDES } from '../docsContentLighting.js';
import { ENUMS_IMAGE } from '../docsContentEnums.js';
import { ENUMS_RUNTIME } from '../docsContentEnumsRuntime.js';
import { LIFECYCLE } from '../docsContentLifecycle.js';
import { CAMERA, HOST_CAMERA } from '../docsContentCamera.js';
import { MATRICES } from '../docsContentMatrix.js';
import { COLORS, VECTORS } from '../docsContentVector.js';
import { BOUNDS } from '../docsContentBounds.js';
import { TREE } from '../docsContentTree.js';
import { BATCHES } from '../docsContentBatches.js';

export const rawEntries = [
  ...GUIDES,
  ...FORMAT_GUIDES,
  ...RENDERING_GUIDES,
  ...ENGINE_GUIDES,
  ...LIGHTING_GUIDES,
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
