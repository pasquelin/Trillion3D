import type { EffectKind } from '../../../sdk-core/src/world/effect/chain.ts';
import { bloomLevelBytes } from './bloomFilter.ts';

/** Bytes each kind holds on a `width × height` image, whatever the number of its passes: they
 *  run one after the other on the same resources. */
export const EFFECT_KIND_BYTES: Record<EffectKind, (width: number, height: number) => number> = {
  bloom: bloomLevelBytes,
};
