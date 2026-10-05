/**
 * An address switch read once, at its first question, and held: every pipeline built after it, pass
 * or consumer, gets the one answer. For a temporary A/B measure, the loser of which is deleted with
 * its switch.
 */
import { addressFlag, heldOnce } from './addressFlag.ts';

/** The address switch `name=1`, read at its first question and held. */
export const heldSwitch = (name: string) =>
  heldOnce(addressFlag((params) => params.get(name) === '1'));
