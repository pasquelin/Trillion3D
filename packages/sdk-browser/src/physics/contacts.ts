import { EVENT, EVENT_WORDS, type ContactEventName } from '../../../sdk-core/src/physics/index.ts';
import type { Bodied } from './bodies.ts';

const emit = (self: Bodied | null, other: Bodied | null, name: ContactEventName, e: number[]) =>
  self?.physics._emit(name, { other, impulse: e[0], point: { x: e[1], y: e[2], z: e[3] } });

/** Hands a tick's `count` contact records, from word `first` of `words`, to both bodies' listeners. */
export function emitContacts(
  words: Uint32Array,
  first: number,
  count: number,
  meshes: readonly (Bodied | null)[],
) {
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length);
  for (let r = 0; r < count; r++) {
    const at = first + r * EVENT_WORDS;
    const a = meshes[words[at + 1]] ?? null,
      b = meshes[words[at + 2]] ?? null;
    const e = [floats[at + 3], floats[at + 4], floats[at + 5], floats[at + 6]];
    const name: ContactEventName = words[at] === EVENT.begin ? 'enter' : 'leave';
    // `contact` joins `enter` when the two touch for real: a sensor only reports presence.
    const solid = name === 'enter' && !a?.physics.sensor && !b?.physics.sensor;
    for (const each of solid ? [name, 'contact' as const] : [name]) {
      emit(a, b, each, e);
      emit(b, a, each, e);
    }
  }
}
