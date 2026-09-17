/**
 * The keys that answer one cutout question, read one press at a time.
 *
 * Enter takes the compiler's proposal, which is what makes a long list short: a pass over sixteen
 * textures is sixteen presses when the measure has them right, and a detour only where it does not.
 */
export type Answer = 'cutout' | 'blend' | 'rest' | 'help' | 'quit';

/** One key, without an Enter to validate it, with the terminal left exactly as it was found. */
async function keypress(input: NodeJS.ReadStream = process.stdin): Promise<string> {
  const wasRaw = input.isRaw;
  input.setRawMode?.(true);
  input.resume();
  try {
    return await new Promise<string>((resolve) => {
      const onData = (data: Buffer) => {
        input.off('data', onData);
        resolve(data.toString('utf8'));
      };
      input.on('data', onData);
    });
  } finally {
    input.setRawMode?.(wasRaw ?? false);
    input.pause();
  }
}

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

/** Asks until a key means something. */
export async function askAnswer(
  proposal: boolean,
  input: NodeJS.ReadStream = process.stdin,
): Promise<Answer> {
  for (;;) {
    const answer = answerOf(await keypress(input), proposal);
    if (answer) return answer;
  }
}
