import { Bloom } from './bloom.ts'
import { EffectChain } from './chain.ts'
import { MotionBlur } from './motionBlur.ts'

/**
 * The chain a world starts with: the motion blur and the bloom a view draws by default, at their
 * defaults (`../../contracts/motionBlurOptions.ts`, `../../contracts/bloomOptions.ts`), the blur
 * ahead of the bloom. Remove them (`world.effects.clear()`), or set the blur's amount and the
 * bloom's intensity to 0, for an image without.
 * @param changed - Runs after every change of the chain or of one of its passes.
 */
export const createWorldEffects = (changed?: () => void) =>
  new EffectChain(changed, [new MotionBlur(), new Bloom()])
