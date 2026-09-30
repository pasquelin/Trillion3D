import { effectChainBytesAt } from '../effects/targets.ts';
import type { BudgetCanvas } from './memoryBudget.ts';

/**
 * GPU bytes of the effect chain's targets on the declared canvas (`../effects/targets.ts`): two
 * pass targets, the WebGL2 scene target and every kind's own, by the one rule the renderers count
 * them with. Held only while a chain has a pass, as the targets follow the image's size.
 */
export const effectTargetReserve = ({ width, height }: BudgetCanvas) =>
  effectChainBytesAt(width, height);
