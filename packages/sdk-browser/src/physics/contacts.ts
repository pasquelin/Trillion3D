import { EVENT, EVENT_WORDS, type ContactEventName } from '../../../sdk-core/src/physics/index.ts';
import type { Bodied } from './bodies.ts';

/** Hands the event to `self`'s handlers, built only when it has one. */
const emit = (
  self: Bodied | null,
  other: Bodied | null,
  name: ContactEventName,
  floats: Float32Array,
  at: number,
) => {
  if (!self?.physics.listens) return;
  const point = { x: floats[at + 4], y: floats[at + 5], z: floats[at + 6] };
  self.physics._emit(name, { other, impulse: floats[at + 3], point });
};

/**
 * Hands a tick's `count` contact records, from word `first` of `words`, to both bodies' listeners;
 * `meshOf` names the mesh of an engine id, `null` once that body left.
 */
export function emitContacts(
  words: Uint32Array,
  first: number,
  count: number,
  meshOf: (id: number) => Bodied | null,
) {
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length);
  for (let r = 0; r < count; r++) {
    const at = first + r * EVENT_WORDS;
    const a = meshOf(words[at + 1]),
      b = meshOf(words[at + 2]);
    const name: ContactEventName = words[at] === EVENT.begin ? 'enter' : 'leave';
    // `contact` joins `enter` when the two touch for real: a sensor only reports presence.
    const solid = name === 'enter' && !a?.physics.sensor && !b?.physics.sensor;
    emit(a, b, name, floats, at);
    emit(b, a, name, floats, at);
    if (!solid) continue;
    emit(a, b, 'contact', floats, at);
    emit(b, a, 'contact', floats, at);
  }
}
