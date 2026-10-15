import type * as body from '../../../../sdk-core/src/collision/characterSettings.ts'
import type { CONTROL_SETTINGS } from './worldControlsSettings.ts'

/** The character's settings of `world.controls`, kept like the others (`worldControlsAccessors.ts`):
 *  the body's own, every default read from an adult human (`body.CharacterSettings`), and the
 *  callbacks the world calls, typed by the one table (`CONTROL_SETTINGS`). */
export interface CharacterSettings extends body.CharacterSettings {
  /** Character only: called on landing with the downward speed in m/s; `null` by default. */
  onLand: (typeof CONTROL_SETTINGS)['onLand']
  /** Character only: called when the body leaves the ground on a jump; `null` by default. */
  onJump: (typeof CONTROL_SETTINGS)['onJump']
}
