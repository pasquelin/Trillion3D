/**
 * Noise made on the spot with Web Audio, for the examples that sound: filtered, it becomes a
 * footstep, a hi-hat, the wind over a wing or the rumble of lava.
 */

/** `seconds` of white noise on one channel, each sample scaled by `envelope(at)`, `at` running
 *  from 0 to 1 along the buffer: flat by default, `(at) => 1 - at` for a hit that fades. */
export function whiteNoise(
  context: BaseAudioContext,
  seconds: number,
  envelope: (at: number) => number = () => 1,
): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let k = 0; k < samples.length; k++)
    samples[k] = (Math.random() * 2 - 1) * envelope(k / samples.length);
  return buffer;
}

/** `seconds` of brown noise: white noise summed with a leak, so the low notes carry it. */
export function brownNoise(context: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = whiteNoise(context, seconds);
  const samples = buffer.getChannelData(0);
  for (let k = 0, last = 0; k < samples.length; k++)
    samples[k] = last = (last + 0.02 * samples[k]) / 1.02;
  return buffer;
}
