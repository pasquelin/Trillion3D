/**
 * THE BOOKKEEPING OF A REFLECTED IMAGE, the engine's (`frame.ts`) and every proof's alike: what the
 * image tells its view.
 */
import { defaultReflections } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import type { ScreenReflection } from './gpu.ts'
import type { ReflectionFrame } from './viewWrite.ts'

/**
 * Stages the reflection view of the image `frame` describes (`ScreenReflection.writeView`). Every
 * image takes the next turn of the view's sample sequence, still or moving: the image's index modulo
 * the sequence's length (`ReflectionSettings.rayDirections`), so a still view's history averages every direction of it.
 */
export function stageReflectionImage(reflection: ScreenReflection, frame: ReflectionFrame) {
  reflection.turn = (reflection.turn + 1) % (frame.settings ?? defaultReflections()).rayDirections
  frame.turn = reflection.turn
  frame.image = ++reflection.images
  reflection.writeView(frame, reflection.lit.held)
}
