import { EVENT, EVENT_WORDS, type ContactEventName } from '../../../sdk-core/src/physics/index.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { Bodied } from './bodies.ts';

/** Hands the event to `self`'s handlers, built only when it has one. */
const emit = (
  self: Bodied | null,
  other: Object3D | null,
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
 * `meshOf` names the mesh of an engine id, `null` once that body left. The character's inner
 * capsule, engine id `character.id`, is named to the other side by `character.eye`, the camera
 * it carries; it has no listeners of its own.
 */
export function emitContacts(
  words: Uint32Array,
  first: number,
  count: number,
  meshOf: (id: number) => Bodied | null,
  character: { id: number; eye: Object3D | null },
) {
  const named = (id: number, mesh: Bodied | null) => (id === character.id ? character.eye : mesh);
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length);
  for (let r = 0; r < count; r++) {
    const at = first + r * EVENT_WORDS;
    const a = meshOf(words[at + 1]),
      b = meshOf(words[at + 2]);
    const name: ContactEventName = words[at] === EVENT.begin ? 'enter' : 'leave';
    // `contact` joins `enter` when the two touch for real: a sensor only reports presence.
    const solid = name === 'enter' && !a?.physics.sensor && !b?.physics.sensor;
    const toA = named(words[at + 2], b),
      toB = named(words[at + 1], a);
    emit(a, toA, name, floats, at);
    emit(b, toB, name, floats, at);
    if (!solid) continue;
    emit(a, toA, 'contact', floats, at);
    emit(b, toB, 'contact', floats, at);
  }
}
