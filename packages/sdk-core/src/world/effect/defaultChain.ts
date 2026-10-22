import { Bloom } from './bloom.ts'
import { EffectChain } from './chain.ts'

/**
 * The chain a world starts with: the bloom a view draws by default, at its defaults
 * (`../../contracts/bloomOptions.ts`). Remove it (`world.effects.clear()`), or set its intensity
 * to 0, for an image without.
 * @param changed - Runs after every change of the chain or of one of its passes.
 */
export const createWorldEffects = (changed?: () => void) => new EffectChain(changed, [new Bloom()])
