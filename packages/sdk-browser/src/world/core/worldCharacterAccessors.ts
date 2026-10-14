import type * as body from '../../../../sdk-core/src/collision/characterSettings.ts'

/** The character's settings of `world.controls`, kept like the others (`worldControlsAccessors.ts`):
 *  the body's own, every default read from an adult human (`body.CharacterSettings`), and the
 *  callbacks the world calls. */
export interface CharacterSettings extends body.CharacterSettings {
  /** Character only: called on landing with the downward speed in m/s; `null` by default. */
  onLand: ((impact: number) => void) | null
  /** Character only: called when the body leaves the ground on a jump; `null` by default. */
  onJump: (() => void) | null
}
