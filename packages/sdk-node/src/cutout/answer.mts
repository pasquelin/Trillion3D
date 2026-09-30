/**
 * The keys that answer one cutout question, read one press at a time.
 *
 * Enter takes the compiler's proposal, which is what makes a long list short: a pass over sixteen
 * textures is sixteen presses when the measure has them right, and a detour only where it does not.
 */
export type Answer = 'cutout' | 'blend' | 'rest' | 'help' | 'quit';

/** What a key means. An unknown key means nothing, and the caller asks again. */
export function answerOf(key: string, proposal: boolean): Answer | null {
  if (key === '\r' || key === '\n' || key === ' ') return proposal ? 'cutout' : 'blend';
  if (key === 'd' || key === 'D') return 'cutout';
  if (key === 'v' || key === 'V') return 'blend';
  if (key === 't' || key === 'T') return 'rest';
  if (key === '?' || key === 'h' || key === 'H') return 'help';
  // Ctrl-C and Escape stop the pass; what was already answered is kept.
  if (key === 'q' || key === 'Q' || key === '' || key === '') return 'quit';
  return null;
}
